// main.js — Electron main process
// Handles: opening the app window, native file dialogs, running the fet-cl
// engine as a child process, and reading back its generated output files.
// All timetable parsing / rendering logic lives in the renderer (renderer.js)
// so that it can reuse the same DOMParser-based code that runs in a browser.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const activeRuns = new Map();

// Log crashes so a black flash + exit is diagnosable (writes next to main.js).
function logCrash(label, err) {
  try {
    const msg = '[' + new Date().toISOString() + '] ' + label + '\n' +
      (err && err.stack ? err.stack : String(err)) + '\n\n';
    fs.appendFileSync(path.join(__dirname, 'crash.log'), msg, 'utf8');
  } catch (e) {}
}
process.on('uncaughtException', (err) => { logCrash('uncaughtException', err); });
process.on('unhandledRejection', (err) => { logCrash('unhandledRejection', err); });

// Some virtual machines / Windows drivers have no usable GPU process; software
// rendering keeps the desktop application startable without affecting generation.
if (typeof app.disableHardwareAcceleration === 'function') app.disableHardwareAcceleration();
try {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
} catch (e) {}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: 'FET Desktop — Manager + Viewer',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logCrash('did-fail-load', { code, desc, url });
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logCrash('render-process-gone', details);
  });
  // Manager is the primary UI (produces .fet files)
  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((err) => {
    logCrash('loadFile index.html', err);
  });
  try {
    const { Menu } = require('electron');
    const template = [
      {
        label: 'File',
        submenu: [
          { label: 'Manager (build FET)', click: () => mainWindow && mainWindow.loadFile(path.join(__dirname, 'index.html')) },
          { label: 'Viewer (generate & print)', click: () => mainWindow && mainWindow.loadFile(path.join(__dirname, 'viewer', 'viewer', 'index.html')) },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } catch (e) {
    logCrash('Menu setup', e);
  }
}

ipcMain.handle('app:navigate', async (_evt, page) => {
  if (!mainWindow) return false;
  if (page === 'viewer') {
    mainWindow.loadFile(path.join(__dirname, 'viewer', 'viewer', 'index.html'));
    return true;
  }
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  return true;
});

app.whenReady().then(() => {
  try {
    createWindow();
  } catch (err) {
    logCrash('createWindow', err);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  logCrash('app.whenReady', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Helpers ----------

function defaultFetClPath() {
  const exe = process.platform === 'win32' ? 'fet-cl.exe' : 'fet-cl';
  const candidates = [
    path.join(__dirname, 'bin', exe),
    path.join(__dirname, 'viewer', 'bin', exe),
    path.join(__dirname, 'viewer', 'viewer', 'bin', exe)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function readIfExists(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  } catch (e) {
    return '';
  }
}

// Recursively look for a file matching a regex under a directory (fet-cl
// nests its output under outputdir/timetables/... depending on version).
function findFileMatching(dir, regex, maxDepth = 6) {
  if (maxDepth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && regex.test(entry.name)) return full;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFileMatching(path.join(dir, entry.name), regex, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

// ---------- IPC: file dialogs ----------


ipcMain.handle('dialog:openFile', async (_evt, extension) => {
  const ext = extension || 'fet';
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open file',
    properties: ['openFile'],
    filters: [{ name: 'FET/XML', extensions: [ext, 'fet', 'xml'] }, { name: 'All', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const p = res.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

ipcMain.handle('dialog:saveFile', async (_evt, { fileName, content, extension }) => {
  const ext = extension || 'fet';
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save file',
    defaultPath: path.join(app.getPath('desktop'), fileName || ('export.' + ext)),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf8');
  return res.filePath;
});

ipcMain.handle('dialog:openFetFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'اختر ملف FET',
    properties: ['openFile'],
    filters: [{ name: 'FET / XML files', extensions: ['fet', 'xml'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const p = res.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

ipcMain.handle('dialog:openActivitiesXml', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'اختر ملف الجدول المولّد (activities.xml أو fet. به الجدول)',
    properties: ['openFile'],
    filters: [{ name: 'FET / XML files', extensions: ['xml', 'fet'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const p = res.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

ipcMain.handle('dialog:pickOutputDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { title: 'اختر مجلد المخرجات', properties: ['openDirectory', 'createDirectory'] });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

ipcMain.handle('dialog:saveFet', async (evt, { filePath, content }) => {
  if (!filePath) return null;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
});

ipcMain.handle('dialog:pickFetCl', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'اختر الملف التنفيذي لمحرك fet-cl',
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:saveText', async (evt, { defaultName, content, extension }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'حفظ الملف',
    defaultPath: defaultName,
    filters: [{ name: extension ? extension.toUpperCase() : 'File', extensions: [extension || 'txt'] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf8');
  return res.filePath;
});

ipcMain.handle('shell:openPath', async (evt, targetPath) => {
  await shell.openPath(targetPath);
});

ipcMain.handle('app:defaultFetClPath', async () => defaultFetClPath());

// Parses FET-CL's own progress log (outputdir/logs/max_placed_activities.txt).
// Each time the solver improves, FET appends a line such as:
//   At time 0 h 1 m 47 s, FET reached 577 activities placed
// We only need the LAST (best-so-far) line.
function readMaxPlaced(outDir) {
  const text = [
    readIfExists(path.join(outDir, 'logs', 'max_placed_activities.txt')),
    readIfExists(path.join(outDir, 'generation.log')),
    readIfExists(path.join(outDir, 'max_record.txt'))
  ].filter(Boolean).join('\n');
  if (!text) return null;
  const candidates = [];
  for (const m of text.matchAll(/At time (\d+) h (\d+) m (\d+) s,\s*FET reached (\d+) activities placed/gi)) {
    candidates.push({ hours: +m[1], minutes: +m[2], seconds: +m[3], placed: +m[4] });
  }
  // FET versions also emit a historical record using this wording. It is
  // authoritative when a later backtracking snapshot contains fewer placed
  // activities than the record already achieved.
  for (const m of text.matchAll(/Highest\s+number\s+of\s+activities\s+placed[^0-9]*(\d+)/gi)) {
    candidates.push({ hours: 0, minutes: 0, seconds: 0, placed: +m[1] });
  }
  const plain = text.match(/(?:highest_placed|max_record)\D+(\d+)/i);
  if (plain) candidates.push({ hours: 0, minutes: 0, seconds: 0, placed: +plain[1] });
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => item.placed > best.placed ? item : best);
}

function readLatestPlaced(outDir) {
  const text = [readIfExists(path.join(outDir, 'logs', 'max_placed_activities.txt')), readIfExists(path.join(outDir, 'generation.log'))].filter(Boolean).join('\n');
  const matches = [...text.matchAll(/At time (\d+) h (\d+) m (\d+) s,\s*FET reached (\d+) activities placed/gi)];
  if (!matches.length) return null;
  const m = matches[matches.length - 1];
  return { hours: +m[1], minutes: +m[2], seconds: +m[3], placed: +m[4] };
}

function persistMaxRecord(outDir, record) {
  if (!record || !Number.isFinite(Number(record.placed))) return;
  const normalized = { placed: Math.max(0, Number(record.placed)), hours: Number(record.hours || 0), minutes: Number(record.minutes || 0), seconds: Number(record.seconds || 0), capturedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(path.join(outDir, 'max_record.txt'), String(normalized.placed));
    fs.writeFileSync(path.join(outDir, 'max_record.json'), JSON.stringify(normalized, null, 2));
  } catch (e) {}
}

function loadHistoricalRecord(outDir) {
  try {
    const json = JSON.parse(readIfExists(path.join(outDir, 'max_record.json')) || '{}');
    if (Number.isFinite(Number(json.placed))) return Object.assign({ hours: 0, minutes: 0, seconds: 0 }, json, { placed: Number(json.placed) });
  } catch (e) {}
  const text = readIfExists(path.join(outDir, 'max_record.txt')).trim();
  return /^\d+$/.test(text) ? { placed: Number(text), hours: 0, minutes: 0, seconds: 0 } : null;
}

function listSnapshotFiles(outDir) {
  const files = [];
  (function walk(dir, depth) {
    if (depth < 0) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'history') walk(full, depth - 1);
      else if (entry.isFile() && /(?:\.fet|_activities\.xml|_timetable\.html)$/i.test(entry.name)) files.push(full);
    }
  })(outDir, 4);
  return files;
}

function captureHistoricalSnapshot(outDir, record, force = false) {
  if (!record || !Number.isFinite(Number(record.placed))) return null;
  const historyDir = path.join(outDir, 'history', 'highest_placed_' + Math.max(0, Number(record.placed)));
  try { fs.mkdirSync(historyDir, { recursive: true }); } catch (e) { return null; }
  try {
    const existing = loadHistoricalRecord(historyDir);
    if (!force && existing && existing.placed >= record.placed) return historyDir;
    for (const source of listSnapshotFiles(outDir)) {
      if (source.startsWith(historyDir + path.sep)) continue;
      try { fs.copyFileSync(source, path.join(historyDir, path.basename(source))); } catch (e) {}
    }
    fs.writeFileSync(path.join(historyDir, 'record.json'), JSON.stringify(Object.assign({}, record, { capturedAt: new Date().toISOString() }), null, 2));
  } catch (e) {}
  return historyDir;
}

function findHighestPlacedFile(outDir) {
  const files = listSnapshotFiles(outDir).filter(p => /(?:\.fet|_activities\.xml|_timetable\.html)$/i.test(p));
  files.sort((a, b) => {
    const score = p => { const n = p.toLowerCase(); return (/(highest[_ -]?stage|highest[_ -]?placed)/.test(n) ? 100 : 0) + (/_activities\.xml$/.test(n) ? 20 : 0) + (/\.fet$/.test(n) ? 10 : 0) + (/approved/.test(n) ? 5 : 0); };
    return score(b) - score(a);
  });
  return files[0] || null;
}

function findSnapshotArtifact(snapshotDir, regex) {
  if (!snapshotDir || !fs.existsSync(snapshotDir)) return null;
  const files = listSnapshotFiles(snapshotDir).filter(p => regex.test(path.basename(p)));
  files.sort((a, b) => {
    const score = p => { const n = path.basename(p).toLowerCase(); return (/(highest[_ -]?stage|highest[_ -]?placed)/.test(n) ? 100 : 0) + (/approved/.test(n) ? 5 : 0); };
    return score(b) - score(a);
  });
  return files[0] || null;
}

function findBestHistoricalSnapshotDir(outDir, placed) {
  const exact = path.join(outDir, 'history', 'highest_placed_' + Math.max(0, Number(placed || 0)));
  if (fs.existsSync(exact)) return exact;
  const history = path.join(outDir, 'history');
  let dirs = [];
  try { dirs = fs.readdirSync(history, { withFileTypes: true }).filter(e => e.isDirectory() && /^highest_placed_\d+$/i.test(e.name)); } catch (e) {}
  dirs.sort((a, b) => Number(b.name.match(/\d+/)[0]) - Number(a.name.match(/\d+/)[0]));
  return dirs.length ? path.join(history, dirs[0].name) : null;
}

function finalizeTableFiles(tableDir, winner, reason) {
  const status = reason || 'COMPLETED';
  try { fs.writeFileSync(path.join(tableDir, 'status.txt'), status + '\n'); } catch (e) {}
  if (!winner) return;
  const historical = winner.historicalMax || loadHistoricalRecord(winner.outDir) || readMaxPlaced(winner.outDir) || { placed: winner.placed };
  persistMaxRecord(winner.outDir, historical);
  const historyDir = captureHistoricalSnapshot(winner.outDir, historical, true);
  if (status === 'MANUAL_STOP') {
    const fromHistory = historyDir && findSnapshotArtifact(historyDir, /\.fet$/i);
    const highest = fromHistory || findHighestPlacedFile(winner.outDir) || winner.fetPath;
    if (highest && fs.existsSync(highest)) {
      try { fs.copyFileSync(highest, path.join(winner.outDir, 'approved_timetable.fet')); } catch (e) {}
    }
    const xml = historyDir && listSnapshotFiles(historyDir).find(p => /_activities\.xml$/i.test(p));
    if (xml) { try { fs.copyFileSync(xml, path.join(winner.outDir, 'approved_activities.xml')); } catch (e) {} }
    try { fs.writeFileSync(path.join(winner.outDir, 'approved_record.json'), JSON.stringify(Object.assign({}, historical, { source: historyDir || highest || null }), null, 2)); } catch (e) {}
  }
}

// Reads back whatever FET produced for one attempt: the authoritative solved
// .fet (data + locked timetable) and/or the _activities.xml. FET may write
// TWO variants when stopped mid-generation (current + "highest stage" via
// SIGTERM/SIGBREAK or the 'sigwrite' protocol) — files whose containing
// folder/name includes "highest" are preferred, since that's FET's own best
// snapshot even if generation was interrupted.
function readAttemptOutput(outDir, totalActivities) {
  const allFet = [];
  const allXml = [];
  (function walk(dir, depth) {
    if (depth < 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && /\.fet$/i.test(entry.name)) allFet.push(full);
      if (entry.isFile() && (/_activities\.xml$/i.test(entry.name) || /activities.*\.xml$/i.test(entry.name) || /_timetable\.xml$/i.test(entry.name) || (/\.xml$/i.test(entry.name) && /activit/i.test(entry.name)))) allXml.push(full);
      if (entry.isDirectory()) walk(full, depth - 1);
    }
  })(outDir, 6);

  const rankPath = p => {
    const n = path.basename(p).toLowerCase();
    return (/(highest[_ -]?stage|highest[_ -]?placed)/.test(n) ? 100 : 0) + (/approved/.test(n) ? 80 : 0) + (/data_and_timetable/.test(n) ? 50 : 0) + (/_activities(?:_timetable)?\.xml$/.test(n) ? 40 : 0) + (/activities.*\.xml$/.test(n) ? 30 : 0) + (/_timetable\.xml$/.test(n) ? 25 : 0) + (/\.fet$/.test(n) ? 10 : 0);
  };
  const pickBest = list => list.slice().sort((a, b) => rankPath(b) - rankPath(a))[0] || null;
  const pickCurrent = list => list.filter(p => !/(highest[_ -]?stage|highest[_ -]?placed|approved|[\/]history[\/])/i.test(p)).slice().sort((a, b) => {
    const score = p => { const n = path.basename(p).toLowerCase(); return (/_activities(?:_timetable)?\.xml$/.test(n) ? 30 : 0) + (/current/.test(n) ? 20 : 0) + (/\.fet$/.test(n) ? 10 : 0); };
    return score(b) - score(a);
  })[0] || null;
  const fetPath = pickBest(allFet);
  const xmlPath = pickBest(allXml);
  const currentFetPath = pickCurrent(allFet) || fetPath;
  const currentXmlPath = pickCurrent(allXml) || xmlPath;
  const activitiesXml = xmlPath ? readIfExists(xmlPath) : '';
  const solvedFetContent = fetPath ? readIfExists(fetPath) : '';
  const currentActivitiesXml = currentXmlPath ? readIfExists(currentXmlPath) : '';
  const currentFetContent = currentFetPath ? readIfExists(currentFetPath) : '';

  const countPlaced = source => {
    if (!source) return 0;
    let count = 0;
    const blocks = source.split(/<Activity[ >]/).slice(1);
    for (const b of blocks) {
      const day = b.match(/<Day>([^<]*)<\/Day>/);
      const hour = b.match(/<Hour>([^<]*)<\/Hour>/);
      if (day && day[1].trim() && hour && hour[1].trim()) count++;
    }
    return count;
  };
  const placedSource = activitiesXml || solvedFetContent;
  const currentSource = currentActivitiesXml || currentFetContent;
  let placed = countPlaced(placedSource);
  let currentPlaced = countPlaced(currentSource);
  const maxPlacedLog = readMaxPlaced(outDir);
  if (!placed && maxPlacedLog) placed = maxPlacedLog.placed;
  if (!currentPlaced && maxPlacedLog) currentPlaced = maxPlacedLog.placed;

  return {
    fetPath, xmlPath, activitiesXml, solvedFetContent, currentFetPath, currentXmlPath, currentActivitiesXml, currentFetContent, placed, currentPlaced,
    complete: totalActivities ? placed >= totalActivities : false
  };
}

// ---------- IPC: run the FET-CL engine (single or multi-attempt) ----------
//
// fet-cl usage (official CLI):
//   fet-cl --inputfile=FILE.fet --outputdir=DIR --timelimitseconds=N
//          --randomseed=N --htmllevel=0..6
// fet-cl has no native GUI-style "multiple tracks" switch. The app simulates
// it by running independent processes in parallel, each in its own folder.
// If a local fet-cl build rejects --randomseed, the track is retried once
// without the optional flag so the complete run can still continue.
// Stops one running attempt as gracefully as possible.
// On Windows FET's sigwrite protocol asks it to persist its best snapshot before
// termination; on POSIX systems SIGTERM gives FET the same opportunity.
async function stopAttempt(attempt) {
  if (!attempt || attempt.finished || !attempt.child) return;
  if (attempt.stopPromise) return attempt.stopPromise;
  attempt.stopPromise = (async () => {
    if (process.platform === 'win32') {
      try { fs.writeFileSync(path.join(attempt.outDir, 'sigwrite'), ''); } catch (e) {}
      await new Promise(r => setTimeout(r, 2500));
      try { attempt.child.kill(); } catch (e) {}
    } else {
      try { attempt.child.kill('SIGTERM'); } catch (e) {}
      await new Promise(r => setTimeout(r, 2500));
      if (!attempt.finished) { try { attempt.child.kill('SIGKILL'); } catch (e) {} }
    }
  })();
  return attempt.stopPromise;
}

function newRandomSeed(attemptIndex, tableIndex) {
  const base = Date.now() + process.pid * 1009 + attemptIndex * 104729 + tableIndex * 130363;
  return (Math.abs(base) % 2147483000) + 1;
}

function looksLikeUnsupportedSeed(output) {
  return /(randomseed|unknown option|unrecognized option|invalid option|usage:|--help)/i.test(output || '');
}

function uniqueOutputDir(parentDir, fetFilePath) {
  const baseName = path.basename(fetFilePath, path.extname(fetFilePath)) || 'fet-output';
  let candidate = path.join(parentDir, baseName);
  let counter = 2;
  while (fs.existsSync(candidate)) { candidate = path.join(parentDir, baseName + '_' + counter); counter++; }
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

// Execute one independent FET-CL process. It never shares an output folder
// with another process, so logs and highest_placed snapshots remain isolated.
function runOneAttempt(exePath, fetFilePath, attemptOutDir, timeLimitSeconds, seed, runState, meta, sendEvent) {
  fs.mkdirSync(attemptOutDir, { recursive: true });
  const attempt = Object.assign({ outDir: attemptOutDir, child: null, finished: false, stopPromise: null, historicalMax: loadHistoricalRecord(attemptOutDir) || { placed: 0, hours: 0, minutes: 0, seconds: 0 }, historicalSnapshotDir: null }, meta);
  runState.attempts.set(meta.globalAttemptIndex, attempt);

  const launch = (withSeed) => new Promise((resolve) => {
    const args = [
      '--inputfile=' + fetFilePath,
      '--outputdir=' + attemptOutDir,
      '--timelimitseconds=' + (timeLimitSeconds || 60),
      '--htmllevel=4'
    ];
    if (withSeed && seed != null) args.push('--randomseed=' + seed);
    const child = spawn(exePath, args, { windowsHide: true });
    attempt.child = child;
    const generationLogPath = path.join(attemptOutDir, 'generation.log');
    try { fs.appendFileSync(generationLogPath, '\n=== ' + new Date().toISOString() + ' ===\n' + args.join(' ') + '\n'); } catch (e) {}
    let stdout = '', stderr = '';
    sendEvent({ type: 'attempt-start', tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, attemptIndex: meta.globalAttemptIndex, totalAttempts: meta.totalAttempts, totalTables: meta.totalTables, tracksPerTable: meta.tracksPerTable, seed: withSeed ? seed : null, command: exePath + ' ' + args.join(' ') });
    const progressTimer = setInterval(() => {
      const mp = readMaxPlaced(attemptOutDir);
      if (mp) {
        const latest = readLatestPlaced(attemptOutDir) || mp;
        if (Number(mp.placed) > Number(attempt.historicalMax.placed || 0)) { attempt.historicalMax = mp; persistMaxRecord(attemptOutDir, mp); attempt.historicalSnapshotDir = captureHistoricalSnapshot(attemptOutDir, mp); sendEvent({ type: 'historical-max', tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, attemptIndex: meta.globalAttemptIndex, totalAttempts: meta.totalAttempts, placed: mp.placed, hours: mp.hours, minutes: mp.minutes, seconds: mp.seconds, snapshotDir: attempt.historicalSnapshotDir }); }
        sendEvent({ type: 'placed', tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, attemptIndex: meta.globalAttemptIndex, totalAttempts: meta.totalAttempts, placed: latest.placed, historicalPlaced: mp.placed, hours: latest.hours, minutes: latest.minutes, seconds: latest.seconds, historicalHours: mp.hours, historicalMinutes: mp.minutes, historicalSeconds: mp.seconds });
      }
    }, 1000);
    child.stdout.on('data', d => { const text = d.toString(); stdout += text; try { fs.appendFileSync(generationLogPath, text); } catch (e) {} sendEvent({ type: 'log', tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, attemptIndex: meta.globalAttemptIndex, text }); });
    child.stderr.on('data', d => { const text = d.toString(); stderr += text; try { fs.appendFileSync(generationLogPath, text); } catch (e) {} sendEvent({ type: 'log', tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, attemptIndex: meta.globalAttemptIndex, text }); });
    child.on('error', error => { clearInterval(progressTimer); attempt.finished = true; resolve({ code: -1, error: error.message, stdout, stderr }); });
    child.on('close', code => { clearInterval(progressTimer); const finalMax = readMaxPlaced(attemptOutDir); if (finalMax && Number(finalMax.placed) >= Number(attempt.historicalMax.placed || 0)) { attempt.historicalMax = finalMax; persistMaxRecord(attemptOutDir, finalMax); attempt.historicalSnapshotDir = captureHistoricalSnapshot(attemptOutDir, finalMax, true); } attempt.finished = true; resolve({ code, stdout, stderr }); });
  });

  return (async () => {
    let result = await launch(seed != null);
    if (seed != null && result.code !== 0 && looksLikeUnsupportedSeed(result.stdout + '\n' + result.stderr) && !runState.stopRequested) {
      sendEvent({ type: 'seed-fallback', tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, attemptIndex: meta.globalAttemptIndex, totalAttempts: meta.totalAttempts, text: 'نسخة fet-cl رفضت --randomseed؛ ستُعاد المحاولة بالعشوائية الداخلية.' });
      attempt.finished = false;
      result = await launch(false);
    }
    return Object.assign(result, { globalAttemptIndex: meta.globalAttemptIndex, tableIndex: meta.tableIndex, trackIndex: meta.trackIndex, outDir: attemptOutDir, seed, historicalMax: attempt.historicalMax, historicalSnapshotDir: attempt.historicalSnapshotDir });
  })();
}

function hasFullTimetable(outDir) {
  return !!findFileMatching(outDir, /_timetable\.html$/i, 8);
}

// Run one table: all tracks start together, and the next table is not started
// until this table has a complete winner (or the user stops the run).
async function runOneTable({ exePath, fetFilePath, tableIndex, totalTables, tracksPerTable, baseOutDir, timeLimitSeconds, totalActivities, useRandomSeed, stopOnPerfect, keepAllAttempts, runState, runId, sendEvent }) {
  const tableDir = path.join(baseOutDir, 'Table_' + tableIndex);
  fs.mkdirSync(tableDir, { recursive: true });
  runState.currentTableDir = tableDir;
  sendEvent({ type: 'table-start', tableIndex, totalTables, tracksPerTable, totalAttempts: totalTables * tracksPerTable });
  const attempts = [];
  const promises = [];
  for (let trackIndex = 1; trackIndex <= tracksPerTable; trackIndex++) {
    const globalAttemptIndex = (tableIndex - 1) * tracksPerTable + trackIndex;
    const trackDir = path.join(tableDir, 'Track_' + trackIndex);
    const seed = (tracksPerTable > 1 && useRandomSeed) ? newRandomSeed(globalAttemptIndex, tableIndex) : null;
    const meta = { globalAttemptIndex, tableIndex, trackIndex, totalTables, tracksPerTable, totalAttempts: totalTables * tracksPerTable };
    promises.push(runOneAttempt(exePath, fetFilePath, trackDir, timeLimitSeconds, seed, runState, meta, sendEvent));
  }

  let winner = null;
  let monitorTimer = null;
  let stopTriggered = false;
  const finished = new Map();
  const evaluate = result => {
    const output = readAttemptOutput(result.outDir, totalActivities);
    const complete = output.complete || hasFullTimetable(result.outDir);
    const historicalMax = result.historicalMax || loadHistoricalRecord(result.outDir) || readMaxPlaced(result.outDir) || { placed: output.placed, hours: 0, minutes: 0, seconds: 0 };
    const record = Object.assign({}, result, output, { complete, historicalMax, historicalSnapshotDir: result.historicalSnapshotDir || findBestHistoricalSnapshotDir(result.outDir, historicalMax.placed), historicalPlaced: Number(historicalMax.placed || 0) });
    finished.set(result.globalAttemptIndex, record);
    sendEvent({ type: 'attempt-done', tableIndex: result.tableIndex, trackIndex: result.trackIndex, attemptIndex: result.globalAttemptIndex, totalAttempts: totalTables * tracksPerTable, placed: output.placed, historicalPlaced: Number(historicalMax.placed || 0), currentPlaced: Number(output.currentPlaced != null ? output.currentPlaced : output.placed || 0), total: totalActivities, complete, code: result.code, error: result.error });
    if (!runState.stopRequested && (!winner || (!stopOnPerfect && ((complete && !winner.complete) || (complete === winner.complete && output.placed > winner.placed))) || (stopOnPerfect && !winner.complete && complete))) winner = record;
    return record;
  };
  const stopOthers = async winningIndex => {
    const jobs = [...runState.attempts.values()].filter(a => a.tableIndex === tableIndex && a.globalAttemptIndex !== winningIndex && !a.finished);
    await Promise.all(jobs.map(stopAttempt));
  };
  const findWinnerAndStop = async result => {
    if (!stopOnPerfect || runState.stopRequested || winner) return;
    const output = readAttemptOutput(result.outDir, totalActivities);
    if (output.complete || hasFullTimetable(result.outDir)) {
      const historicalMax = result.historicalMax || loadHistoricalRecord(result.outDir) || readMaxPlaced(result.outDir) || { placed: output.placed, hours: 0, minutes: 0, seconds: 0 };
      winner = Object.assign({ globalAttemptIndex: result.globalAttemptIndex, tableIndex, trackIndex: result.trackIndex, outDir: result.outDir, seed: result.seed, code: result.code }, output, { complete: true, historicalMax, historicalPlaced: Number(historicalMax.placed || 0), currentPlaced: Number(output.currentPlaced != null ? output.currentPlaced : output.placed || 0), historicalSnapshotDir: result.historicalSnapshotDir });
      sendEvent({ type: 'winner-found', tableIndex, trackIndex: result.trackIndex, attemptIndex: result.globalAttemptIndex, totalAttempts: totalTables * tracksPerTable, placed: output.placed, historicalPlaced: Number(historicalMax.placed || 0), currentPlaced: Number(output.currentPlaced != null ? output.currentPlaced : output.placed || 0), outDir: result.outDir });
      await stopOthers(result.globalAttemptIndex);
      stopTriggered = true;
    }
  };
  promises.forEach(p => p.then(findWinnerAndStop));
  const allDone = Promise.all(promises);
  const monitor = new Promise(resolve => {
    monitorTimer = setInterval(async () => {
      if (runState.stopRequested) {
        clearInterval(monitorTimer); monitorTimer = null;
        await Promise.all([...runState.attempts.values()].filter(a => a.tableIndex === tableIndex && !a.finished).map(stopAttempt));
        resolve(); return;
      }
      if (stopOnPerfect && winner) { clearInterval(monitorTimer); monitorTimer = null; resolve(); return; }
      for (const attempt of [...runState.attempts.values()].filter(a => a.tableIndex === tableIndex)) {
        const output = readAttemptOutput(attempt.outDir, totalActivities);
        if (output.complete || hasFullTimetable(attempt.outDir)) {
          if (!winner) {
            const historicalMax = loadHistoricalRecord(attempt.outDir) || readMaxPlaced(attempt.outDir) || { placed: output.placed, hours: 0, minutes: 0, seconds: 0 };
            winner = Object.assign({ globalAttemptIndex: attempt.globalAttemptIndex, tableIndex, trackIndex: attempt.trackIndex, outDir: attempt.outDir, seed: null, code: null }, output, { complete: true, historicalMax, historicalPlaced: Number(historicalMax.placed || 0), currentPlaced: Number(output.currentPlaced != null ? output.currentPlaced : output.placed || 0), historicalSnapshotDir: findBestHistoricalSnapshotDir(attempt.outDir, historicalMax.placed) });
            sendEvent({ type: 'winner-found', tableIndex, trackIndex: attempt.trackIndex, attemptIndex: attempt.globalAttemptIndex, totalAttempts: totalTables * tracksPerTable, placed: output.placed, historicalPlaced: Number(historicalMax.placed || 0), currentPlaced: Number(output.currentPlaced != null ? output.currentPlaced : output.placed || 0), outDir: attempt.outDir });
            await stopOthers(attempt.globalAttemptIndex);
          }
          clearInterval(monitorTimer); monitorTimer = null; resolve(); return;
        }
      }
      if ([...runState.attempts.values()].filter(a => a.tableIndex === tableIndex).every(a => a.finished)) { clearInterval(monitorTimer); monitorTimer = null; resolve(); }
    }, 1000);
  });
  await Promise.race([allDone, monitor]);
  const results = await allDone;
  results.forEach(r => { if (!finished.has(r.globalAttemptIndex)) evaluate(r); });
  if (monitorTimer) clearInterval(monitorTimer);
  if (runState.stopRequested) { winner = [...finished.values()].sort((a, b) => (Number(b.historicalPlaced || 0) - Number(a.historicalPlaced || 0)) || (Number(b.placed || 0) - Number(a.placed || 0)))[0] || null; }
  if (!winner) for (const record of finished.values()) if (!winner || record.placed > winner.placed) winner = record;
  const tableAttempts = [...finished.values()].sort((a, b) => a.trackIndex - b.trackIndex).map(a => ({
    attemptIndex: a.globalAttemptIndex, tableIndex: a.tableIndex, trackIndex: a.trackIndex, outDir: a.outDir,
    placed: a.placed, historicalPlaced: a.historicalPlaced || (a.historicalMax && a.historicalMax.placed) || a.placed, historicalMax: a.historicalMax || null, historicalSnapshotDir: a.historicalSnapshotDir || null, complete: a.complete, seed: a.seed, exitCode: a.code, error: a.error,
    cmdLine: exePath + ' --inputfile=' + fetFilePath + ' --outputdir=' + a.outDir + ' --timelimitseconds=' + timeLimitSeconds + (a.seed != null ? ' --randomseed=' + a.seed : ''),
    stdout: (a.stdout || '').slice(-2000), stderr: (a.stderr || '').slice(-2000)
  }));
  const tableReason = runState.stopRequested ? 'MANUAL_STOP' : (winner && winner.complete ? 'SUCCESS' : 'COMPLETED');
  finalizeTableFiles(tableDir, winner, tableReason);
  // Treat as valid if we have timetable content OR a complete/partial placement with output dir
  if (winner && !winner.activitiesXml && !winner.solvedFetContent && winner.outDir) {
    try {
      const deeperXml = findFileMatching(winner.outDir, /(?:activities|timetable).*\.xml$/i, 8);
      const deeperFet = findFileMatching(winner.outDir, /data_and_timetable|\.fet$/i, 8);
      if (deeperXml) { winner.xmlPath = deeperXml; winner.activitiesXml = readIfExists(deeperXml); }
      if (deeperFet && !winner.solvedFetContent) { winner.fetPath = deeperFet; winner.solvedFetContent = readIfExists(deeperFet); }
    } catch (e) {}
  }
  const valid = !!(winner && (winner.activitiesXml || winner.solvedFetContent || (winner.complete && winner.outDir) || (Number(winner.placed || 0) > 0 && winner.outDir)));
  sendEvent({ type: 'table-done', tableIndex, totalTables, trackIndex: winner && winner.trackIndex, attemptIndex: winner && winner.globalAttemptIndex, placed: winner && (winner.historicalPlaced || winner.placed) || 0, historicalPlaced: winner && (winner.historicalPlaced || winner.placed) || 0, currentPlaced: winner && (winner.currentPlaced || winner.placed) || 0, total: totalActivities, complete: !!(winner && winner.complete), outDir: winner && winner.outDir });
  if (!keepAllAttempts && winner) for (const a of tableAttempts) if (a.outDir !== winner.outDir) { try { fs.rmSync(a.outDir, { recursive: true, force: true }); } catch (e) {} }
  return { tableIndex, tableDir, winner, attempts: tableAttempts, valid, complete: !!(winner && winner.complete), stopped: runState.stopRequested, stopTriggered };
}

// ---------- IPC: sequential tables + parallel tracks ----------
ipcMain.handle('run:generate', async (evt, opts) => {
  const { fetFilePath, fetClPath, timeLimitSeconds, outputDir, runId, totalActivities,
    numTables = 1, tracksPerTable = 1, stopOnPerfect = true, keepAllAttempts = false,
    useRandomSeed = true } = opts;
  const exePath = fetClPath && fetClPath.trim() ? fetClPath.trim() : defaultFetClPath();
  if (!fs.existsSync(exePath)) return { success: false, error: 'لم يتم العثور على الملف التنفيذي لمحرك fet-cl في المسار:\n' + exePath };
  if (!fetFilePath || !fs.existsSync(fetFilePath)) return { success: false, error: 'ملف FET المُدخل غير موجود على القرص.' };

  const parentDir = outputDir && outputDir.trim() ? outputDir.trim() : path.dirname(fetFilePath);
  let baseOutDir;
  try { baseOutDir = uniqueOutputDir(parentDir, fetFilePath); }
  catch (e) { baseOutDir = uniqueOutputDir(os.tmpdir(), fetFilePath); }
  const id = runId || String(Date.now());
  const runState = { stopRequested: false, attempts: new Map() };
  activeRuns.set(id, runState);
  const totalTables = Math.max(1, Math.min(20, Number(numTables) || 1));
  const tracks = Math.max(1, Math.min(20, Number(tracksPerTable) || 1));
  const sendEvent = data => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('generation:progress', Object.assign({ runId: id }, data)); };
  const tableResults = [];
  for (let tableIndex = 1; tableIndex <= totalTables; tableIndex++) {
    if (runState.stopRequested) break;
    const tableResult = await runOneTable({ exePath, fetFilePath, tableIndex, totalTables, tracksPerTable: tracks, baseOutDir, timeLimitSeconds: timeLimitSeconds || 60, totalActivities, useRandomSeed, stopOnPerfect, keepAllAttempts, runState, runId: id, sendEvent });
    tableResults.push(tableResult);
    // The next table begins only after this table has a complete solution.
    if (!tableResult.complete || runState.stopRequested) break;
  }
  activeRuns.delete(id);
  let firstValid = tableResults.find(t => t.valid);
  const allComplete = tableResults.length === totalTables && tableResults.every(t => t.complete);
  const attempts = tableResults.flatMap(t => t.attempts);
  // Fallback: pick best attempt even if XML not yet parsed
  if (!firstValid) {
    let best = null;
    for (const t of tableResults) {
      for (const a of (t.attempts || [])) {
        const score = Number(a.historicalPlaced || a.placed || 0);
        if (!best || score > Number(best.placed || 0)) best = Object.assign({}, a, { tableIndex: t.tableIndex });
      }
      if (t.winner && (!best || Number(t.winner.placed || 0) >= Number(best.placed || 0))) {
        best = Object.assign({}, t.winner, { tableIndex: t.tableIndex });
      }
    }
    if (best && (Number(best.placed || 0) > 0 || best.complete)) {
      // re-scan output dirs for artifacts
      const scanDir = best.outDir || baseOutDir;
      let xml = best.activitiesXml || '';
      let xmlPath = best.xmlPath || null;
      let fetContent = best.solvedFetContent || '';
      let fetPath = best.fetPath || null;
      try {
        if (!xml) {
          xmlPath = findFileMatching(scanDir, /(?:activities|timetable).*\.xml$/i, 8);
          if (xmlPath) xml = readIfExists(xmlPath);
        }
        if (!fetContent) {
          fetPath = findFileMatching(scanDir, /data_and_timetable|timetable.*\.fet$/i, 8) || findFileMatching(scanDir, /\.fet$/i, 8);
          if (fetPath) fetContent = readIfExists(fetPath);
        }
      } catch (e) {}
      if (xml || fetContent || best.complete) {
        firstValid = {
          tableIndex: best.tableIndex || 1,
          winner: Object.assign({}, best, {
            activitiesXml: xml,
            xmlPath,
            solvedFetContent: fetContent,
            fetPath,
            placed: Number(best.historicalPlaced || best.placed || 0),
            complete: !!best.complete || (totalActivities > 0 && Number(best.placed || 0) >= totalActivities)
          })
        };
      }
    }
  }
  if (!firstValid) return { success: false, cancelled: runState.stopRequested, error: runState.stopRequested ? 'تم إيقاف التوليد قبل إنتاج أي جدول صالح.' : 'لم ينتج محرك fet-cl أي جدول صالح.', attempts, tableResults: tableResults.map(t => ({ tableIndex: t.tableIndex, complete: t.complete, outDir: t.tableDir })), outDir: baseOutDir, totalTables, tracksPerTable: tracks };
  const selected = firstValid.winner;
  sendEvent({ type: 'run-done', totalTables, completedTables: tableResults.filter(t => t.complete).length, totalAttempts: totalTables * tracks, winnerAttempt: selected.globalAttemptIndex, winnerTable: firstValid.tableIndex, winnerTrack: selected.trackIndex, placed: Number(selected.historicalPlaced || selected.placed || 0), historicalPlaced: Number(selected.historicalPlaced || selected.placed || 0), currentPlaced: Number(selected.currentPlaced != null ? selected.currentPlaced : selected.placed || 0), total: totalActivities, complete: allComplete, outDir: baseOutDir });
  return {
    success: true, cancelled: runState.stopRequested, complete: allComplete, completedTables: tableResults.filter(t => t.complete).length,
    totalTables, tracksPerTable: tracks, winnerAttempt: selected.globalAttemptIndex, winnerTable: firstValid.tableIndex, winnerTrack: selected.trackIndex,
    totalAttempts: totalTables * tracks, placed: Number(selected.historicalPlaced || selected.placed || 0), historicalPlaced: Number(selected.historicalPlaced || selected.placed || 0), currentPlaced: Number(selected.currentPlaced || selected.placed || 0), total: totalActivities, outDir: baseOutDir,
    winnerOutDir: selected.outDir, historicalSnapshotDir: selected.historicalSnapshotDir || null, historicalMax: selected.historicalMax || null, activitiesXmlPath: selected.xmlPath, activitiesXml: selected.activitiesXml,
    solvedFetPath: selected.fetPath, solvedFetContent: selected.solvedFetContent, attempts,
    tableResults: tableResults.map(t => ({ tableIndex: t.tableIndex, complete: t.complete, winnerTrack: t.winner && t.winner.trackIndex, outDir: t.tableDir }))
  };
});

ipcMain.handle('run:cancel', async (evt, runId) => {
  const runState = activeRuns.get(runId);
  if (!runState) return false;
  runState.stopRequested = true;
  if (runState.currentTableDir) { try { fs.writeFileSync(path.join(runState.currentTableDir, 'stop_signal.cmd'), 'MANUAL_STOP\n'); } catch (e) {} }
  await Promise.all([...runState.attempts.values()].filter(a => !a.finished).map(stopAttempt));
  return true;
});
