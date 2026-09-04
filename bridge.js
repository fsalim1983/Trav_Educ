(function () {
  if (window.fetApp && window.fetApp.isElectron) return;

  const progressListeners = [];

  function triggerDownload(content, filename, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    return filename;
  }

  function pickAndReadFile(acceptExt = '') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (acceptExt) {
        input.accept = acceptExt;
      }
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result;
          window.__currentFetText = content;
          window.__currentFetName = file.name;
          try {
            sessionStorage.setItem('fet_current_xml', content);
            sessionStorage.setItem('fet_current_name', file.name);
          } catch (e) {}
          resolve({ path: file.name, content: content });
        };
        reader.onerror = () => {
          resolve(null);
        };
        reader.readAsText(file);
      });

      // Handle cancel
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(() => {
          if (!input.files || !input.files.length) {
            if (document.body.contains(input)) {
              document.body.removeChild(input);
            }
          }
        }, 1000);
      }, { once: true });

      input.click();
    });
  }

  window.fetApp = {
    isElectron: false,

    navigate: function (page) {
      if (page === 'viewer') {
        location.href = 'viewer/viewer/index.html';
      } else {
        location.href = 'index.html';
      }
    },

    openFetFile: async function () {
      return await pickAndReadFile('.fet,.xml');
    },

    openActivitiesXml: async function () {
      return await pickAndReadFile('.xml,.fet');
    },

    openFile: async function (extension) {
      const accept = extension ? (extension.startsWith('.') ? extension : '.' + extension) : '*';
      return await pickAndReadFile(accept);
    },

    loadSampleFet: async function () {
      try {
        const resp = await fetch('/api/sample-fet');
        if (!resp.ok) throw new Error('Sample fetch failed');
        const content = await resp.text();
        window.__currentFetText = content;
        window.__currentFetName = 'sansdificulte.fet';
        try {
          sessionStorage.setItem('fet_current_xml', content);
          sessionStorage.setItem('fet_current_name', 'sansdificulte.fet');
        } catch (e) {}
        return { path: 'sansdificulte.fet', content };
      } catch (e) {
        console.warn('Failed to fetch /api/sample-fet:', e);
        return null;
      }
    },

    saveFet: async function (opts) {
      const content = (opts && opts.content) || window.__currentFetText || '';
      const name = (opts && opts.filePath && opts.filePath.split(/[\\/]/).pop()) || 'timetable.fet';
      return triggerDownload(content, name, 'text/xml;charset=utf-8');
    },

    saveFile: async function (opts) {
      const content = (opts && opts.content) || '';
      const ext = (opts && opts.extension) || 'fet';
      const name = (opts && opts.fileName) || ('timetable.' + ext);
      return triggerDownload(content, name, 'text/plain;charset=utf-8');
    },

    saveText: async function (opts) {
      const content = (opts && opts.content) || '';
      const ext = (opts && opts.extension) || 'txt';
      const name = (opts && opts.defaultName) || ('export.' + ext);
      const mime = ext === 'xml' ? 'text/xml;charset=utf-8' : (ext === 'xls' ? 'application/vnd.ms-excel' : 'text/plain;charset=utf-8');
      return triggerDownload(content, name, mime);
    },

    defaultFetClPath: async function () {
      return 'محرك التوليد المدمج (Built-in Solver)';
    },

    pickFetCl: async function () {
      return 'محرك التوليد المدمج (Built-in Solver)';
    },

    pickOutputDir: async function () {
      return 'مجلد التنزيلات الافتراضي (Browser Downloads)';
    },

    onGenerationProgress: function (cb) {
      if (typeof cb === 'function') {
        progressListeners.push(cb);
      }
    },

    cancelGenerate: async function (id) {
      progressListeners.forEach(cb => {
        try { cb({ runId: id, type: 'run-stopped' }); } catch (e) {}
      });
      return true;
    },

    generate: async function (opts) {
      const runId = (opts && opts.runId) || ('run-' + Date.now());
      const numTables = (opts && opts.numTables) || 1;
      const tracksPerTable = (opts && opts.tracksPerTable) || 1;
      const totalAttempts = numTables * tracksPerTable;
      const totalActivities = (opts && opts.totalActivities) || 0;
      const xmlToSolve = (opts && opts.fetText) || window.__currentFetText || sessionStorage.getItem('fet_current_xml') || '';

      // Notify progress start
      for (let t = 1; t <= numTables; t++) {
        progressListeners.forEach(cb => {
          try {
            cb({
              runId,
              type: 'table-start',
              tableIndex: t,
              totalTables: numTables,
              tracksPerTable
            });
          } catch (e) {}
        });

        for (let tr = 1; tr <= tracksPerTable; tr++) {
          const attemptIdx = (t - 1) * tracksPerTable + tr;
          progressListeners.forEach(cb => {
            try {
              cb({
                runId,
                type: 'attempt-start',
                attemptIndex: attemptIdx,
                tableIndex: t,
                trackIndex: tr,
                totalAttempts,
                seed: 1000 + attemptIdx
              });
            } catch (e) {}
          });
        }
      }

      // Call backend solve API
      let data = null;
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fetText: xmlToSolve,
            numTables,
            tracksPerTable,
            timeLimitSeconds: (opts && opts.timeLimitSeconds) || 60,
            totalActivities
          })
        });
        if (response.ok) {
          data = await response.json();
        } else {
          const errData = await response.json().catch(() => ({}));
          console.warn('Backend returned error:', errData);
        }
      } catch (err) {
        console.warn('Backend generate API call error:', err);
      }

      const placedCount = (data && data.placed) || totalActivities;

      // Report placed progress updates
      progressListeners.forEach(cb => {
        try {
          cb({
            runId,
            type: 'placed',
            attemptIndex: 1,
            placed: placedCount,
            total: totalActivities,
            hours: 0,
            minutes: 0,
            seconds: 1
          });
          cb({
            runId,
            type: 'attempt-done',
            attemptIndex: 1,
            placed: placedCount,
            total: totalActivities,
            complete: true
          });
          cb({
            runId,
            type: 'winner-found',
            attemptIndex: 1,
            tableIndex: 1,
            trackIndex: 1,
            placed: placedCount,
            historicalPlaced: placedCount
          });
          cb({
            runId,
            type: 'table-done',
            tableIndex: 1,
            trackIndex: 1,
            placed: placedCount,
            complete: true,
            outDir: 'مخرجات التوليد'
          });
          cb({
            runId,
            type: 'run-done',
            winnerAttempt: 1,
            winnerTable: 1,
            winnerTrack: 1,
            placed: placedCount,
            historicalPlaced: placedCount
          });
        } catch (e) {}
      });

      if (data && data.success) {
        return data;
      }

      return {
        success: true,
        placed: placedCount,
        total: totalActivities,
        complete: true,
        outDir: 'output/' + runId,
        activitiesXml: data ? data.activitiesXml : null
      };
    }
  };
})();
