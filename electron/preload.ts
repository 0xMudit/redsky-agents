import { contextBridge, ipcRenderer } from 'electron'

const redsky = {
  init: () => ipcRenderer.invoke('rs:init'),
  models: () => ipcRenderer.invoke('rs:models'),
  createBot: (payload?: { name?: string; job?: string }) => ipcRenderer.invoke('rs:createBot', payload),
  renameBot: (botId: string, payload: { name: string; job?: string }) => ipcRenderer.invoke('rs:renameBot', botId, payload),
  duplicateBot: (botId: string) => ipcRenderer.invoke('rs:duplicateBot', botId),
  setBotFlags: (botId: string, flags: { pinned?: boolean; archived?: boolean }) =>
    ipcRenderer.invoke('rs:setBotFlags', botId, flags),
  reorderBots: (orderedIds: string[]) => ipcRenderer.invoke('rs:reorderBots', orderedIds),
  branchFrom: (botId: string, messageId: string, model?: string) =>
    ipcRenderer.invoke('rs:branchFrom', botId, messageId, model),
  search: (query: string) => ipcRenderer.invoke('rs:search', query),
  lifeTip: () => ipcRenderer.invoke('rs:lifeTip'),
  send: (botId: string, payload: { text: string; model?: string; roomId?: string }) =>
    ipcRenderer.invoke('rs:send', botId, payload),
  abortBot: (botId: string) => ipcRenderer.invoke('rs:abortBot', botId),
  listBots: () => ipcRenderer.invoke('rs:listBots'),
  deleteBot: (botId: string) => ipcRenderer.invoke('rs:deleteBot', botId),
  patchMessage: (botId: string, messageId: string, text: string) =>
    ipcRenderer.invoke('rs:patchMessage', botId, messageId, text),
  deleteMessage: (botId: string, messageId: string) => ipcRenderer.invoke('rs:deleteMessage', botId, messageId),
  clearThread: (botId: string) => ipcRenderer.invoke('rs:clearThread', botId),
  resendFrom: (botId: string, messageId: string, model?: string) =>
    ipcRenderer.invoke('rs:resendFrom', botId, messageId, model),
  permission: (payload: { botId: string; permissionId: string; response: 'once' | 'always' | 'reject' }) =>
    ipcRenderer.invoke('rs:permission', payload),
  files: (rel?: string) => ipcRenderer.invoke('rs:files', rel),
  fileContent: (rel: string) => ipcRenderer.invoke('rs:fileContent', rel),
  importFiles: (files: { name: string; data: Uint8Array }[]) => ipcRenderer.invoke('rs:importFiles', files),
  listMemories: (botId?: string) => ipcRenderer.invoke('rs:listMemories', botId),
  addMemory: (payload: { key: string; value: string; botId?: string }) => ipcRenderer.invoke('rs:addMemory', payload),
  deleteMemory: (id: string) => ipcRenderer.invoke('rs:deleteMemory', id),
  clearMemories: () => ipcRenderer.invoke('rs:clearMemories'),
  listHistory: (user?: string) => ipcRenderer.invoke('rs:listHistory', user),
  listRoutines: () => ipcRenderer.invoke('rs:listRoutines'),
  addRoutine: (payload: { botId: string; schedule: string; prompt: string; origin?: 'manual' | 'taught' }) =>
    ipcRenderer.invoke('rs:addRoutine', payload),
  removeRoutine: (id: string) => ipcRenderer.invoke('rs:removeRoutine', id),
  toggleRoutine: (id: string, enabled: boolean) => ipcRenderer.invoke('rs:toggleRoutine', id, enabled),
  teachRoutine: (payload: { botId: string; schedule: string }) => ipcRenderer.invoke('rs:teachRoutine', payload),
  setWatchMode: (botId: string, enabled: boolean) => ipcRenderer.invoke('rs:setWatchMode', botId, enabled),
  listConnectors: () => ipcRenderer.invoke('rs:listConnectors'),
  updateConnector: (payload: { id: string; status: 'disconnected' | 'connected' | 'error'; note?: string }) =>
    ipcRenderer.invoke('rs:updateConnector', payload),
  listRooms: () => ipcRenderer.invoke('rs:listRooms'),
  createRoom: (payload: { title?: string; participantIds: string[] }) => ipcRenderer.invoke('rs:createRoom', payload),
  addToRoom: (roomId: string, botId: string) => ipcRenderer.invoke('rs:addToRoom', roomId, botId),
  renameRoom: (roomId: string, title: string) => ipcRenderer.invoke('rs:renameRoom', roomId, title),
  deleteRoom: (roomId: string) => ipcRenderer.invoke('rs:deleteRoom', roomId),
  listNotes: (opts?: { limit?: number }) => ipcRenderer.invoke('rs:listNotes', opts),
  searchNotes: (query: string, opts?: { limit?: number }) => ipcRenderer.invoke('rs:searchNotes', query, opts),
  getNote: (id: string) => ipcRenderer.invoke('rs:getNote', id),
  createNote: (payload: unknown) => ipcRenderer.invoke('rs:createNote', payload),
  updateNote: (id: string, patch: unknown) => ipcRenderer.invoke('rs:updateNote', id, patch),
  appendToNote: (id: string, text: string) => ipcRenderer.invoke('rs:appendToNote', id, text),
  deleteNote: (id: string) => ipcRenderer.invoke('rs:deleteNote', id),
  listNotices: () => ipcRenderer.invoke('rs:listNotices'),
  markNoticeRead: (id: string) => ipcRenderer.invoke('rs:markNoticeRead', id),
  markAllNoticesRead: () => ipcRenderer.invoke('rs:markAllNoticesRead'),
  clearNotices: () => ipcRenderer.invoke('rs:clearNotices'),
  getSettings: () => ipcRenderer.invoke('rs:getSettings'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('rs:updateSettings', patch),
  cloudStatus: () => ipcRenderer.invoke('rs:cloudStatus'),
  listComputers: () => ipcRenderer.invoke('rs:listComputers'),
  ensureComputer: (botId: string) => ipcRenderer.invoke('rs:ensureComputer', botId),
  stopComputer: (botId: string) => ipcRenderer.invoke('rs:stopComputer', botId),
  listDevices: () => ipcRenderer.invoke('rs:listDevices'),
  registerDevice: (payload: { name: string; platform: 'desktop' | 'web' | 'ios' | 'android'; push?: boolean }) =>
    ipcRenderer.invoke('rs:registerDevice', payload),
  removeDevice: (id: string) => ipcRenderer.invoke('rs:removeDevice', id),
  listRecordings: (botId?: string) => ipcRenderer.invoke('rs:listRecordings', botId),
  startRecording: (payload: { botId: string; title?: string }) => ipcRenderer.invoke('rs:startRecording', payload),
  captureRecording: (id: string, step: { kind: string; title: string; detail: string }) =>
    ipcRenderer.invoke('rs:captureRecording', id, step),
  stopRecording: (id: string) => ipcRenderer.invoke('rs:stopRecording', id),
  saveRecordingAsRoutine: (payload: { id: string; schedule: string }) =>
    ipcRenderer.invoke('rs:saveRecordingAsRoutine', payload),
  listHandoffs: (botId?: string) => ipcRenderer.invoke('rs:listHandoffs', botId),
  queueHandoff: (payload: { fromBotId: string; toBotId: string; prompt: string }) =>
    ipcRenderer.invoke('rs:queueHandoff', payload),
  listFederated: (botId?: string) => ipcRenderer.invoke('rs:listFederated', botId),
  publishFact: (payload: { key: string; value: string; botId?: string }) => ipcRenderer.invoke('rs:publishFact', payload),
  forgetFact: (id: string) => ipcRenderer.invoke('rs:forgetFact', id),
  openWorkspace: () => ipcRenderer.invoke('rs:openWorkspace'),
  openLogs: () => ipcRenderer.invoke('rs:openLogs'),
  setupCheck: () => ipcRenderer.invoke('rs:setupCheck'),
  openFeedback: () => ipcRenderer.invoke('rs:openFeedback'),
  windowMinimize: (): void => ipcRenderer.send('win:minimize'),
  windowMaximize: (): void => ipcRenderer.send('win:maximize'),
  windowClose: (): void => ipcRenderer.send('win:close'),
  onEvent: (cb: (evt: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: unknown) => cb(evt)
    ipcRenderer.on('rs:event', listener)
    return () => ipcRenderer.removeListener('rs:event', listener)
  },
}

contextBridge.exposeInMainWorld('redsky', redsky)

export type RedSkyApi = typeof redsky
