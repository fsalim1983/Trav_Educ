const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fetApp', {
  openFetFile: () => ipcRenderer.invoke('dialog:openFetFile'),
  openActivitiesXml: () => ipcRenderer.invoke('dialog:openActivitiesXml'),
  pickFetCl: () => ipcRenderer.invoke('dialog:pickFetCl'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  saveFet: (opts) => ipcRenderer.invoke('dialog:saveFet', opts),
  saveText: (opts) => ipcRenderer.invoke('dialog:saveText', opts),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  defaultFetClPath: () => ipcRenderer.invoke('app:defaultFetClPath'),
  generate: (opts) => ipcRenderer.invoke('run:generate', opts),
  cancelGenerate: (id) => ipcRenderer.invoke('run:cancel', id),
  onGenerationProgress: (cb) => ipcRenderer.on('generation:progress', (e, data) => cb(data)),
  navigate: (page) => ipcRenderer.invoke('app:navigate', page),
  openFile: (extension) => ipcRenderer.invoke('dialog:openFile', extension),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  isElectron: true
});
