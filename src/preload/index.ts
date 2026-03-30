import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('flowraAPI', {
  analyzeConversation: (text: string) =>
    ipcRenderer.invoke('analyze-conversation', text),
  evaluatePractice: (originalTurn: string, context: string, rewrite: string) =>
    ipcRenderer.invoke('evaluate-practice', originalTurn, context, rewrite),
  generateStyles: (originalTurn: string, context: string) =>
    ipcRenderer.invoke('generate-styles', originalTurn, context),
  liveAnalyze: (conversationSoFar: string, latestMessage: string) =>
    ipcRenderer.invoke('live-analyze', conversationSoFar, latestMessage),
  parseTranscript: (rawText: string) =>
    ipcRenderer.invoke('parse-transcript', rawText),
  openFileDialog: () =>
    ipcRenderer.invoke('open-file-dialog'),
  transcribeAudio: (base64Audio: string, mimeType: string, meta?: unknown) =>
    ipcRenderer.invoke('transcribe-audio', base64Audio, mimeType, meta),
  abortSession: (sessionId: string) =>
    ipcRenderer.invoke('abort-session', sessionId),

  windowMinimize: () =>
    ipcRenderer.invoke('window-minimize'),
  windowMaximize: () =>
    ipcRenderer.invoke('window-maximize'),
  windowClose: () =>
    ipcRenderer.invoke('window-close'),

  getDesktopSources: () =>
    ipcRenderer.invoke('get-desktop-sources'),

  registerLiveHotkeys: () =>
    ipcRenderer.invoke('register-live-hotkeys'),
  unregisterLiveHotkeys: () =>
    ipcRenderer.invoke('unregister-live-hotkeys'),

  meetingBootstrap: () =>
    ipcRenderer.invoke('meeting-bootstrap'),
  showMainWindow: () =>
    ipcRenderer.invoke('show-main-window'),
  quitApp: () =>
    ipcRenderer.invoke('quit-app'),

  backupTranscript: (text: string) =>
    ipcRenderer.invoke('backup-transcript', text),
  backupLiveSession: (payload: unknown) =>
    ipcRenderer.invoke('backup-live-session', payload),

  toggleOverlay: () =>
    ipcRenderer.invoke('toggle-overlay'),
  setAlwaysOnTop: (onTop: boolean) =>
    ipcRenderer.invoke('set-always-on-top', onTop),

  onHotkeyToggleRecording: (callback: () => void) => {
    ipcRenderer.on('hotkey-toggle-recording', callback)
    return () => ipcRenderer.removeListener('hotkey-toggle-recording', callback)
  },
  onHotkeyQuickAnalysis: (callback: () => void) => {
    ipcRenderer.on('hotkey-quick-analysis', callback)
    return () => ipcRenderer.removeListener('hotkey-quick-analysis', callback)
  },
  onHotkeyPauseResume: (callback: () => void) => {
    ipcRenderer.on('hotkey-pause-resume', callback)
    return () => ipcRenderer.removeListener('hotkey-pause-resume', callback)
  },
  onHotkeyOverlayToggle: (callback: () => void) => {
    ipcRenderer.on('hotkey-overlay-toggle', callback)
    return () => ipcRenderer.removeListener('hotkey-overlay-toggle', callback)
  },
  onHotkeyEndSession: (callback: () => void) => {
    ipcRenderer.on('hotkey-end-session', callback)
    return () => ipcRenderer.removeListener('hotkey-end-session', callback)
  },
  onSyncOverlay: (callback: (payload: { overlay: boolean }) => void) => {
    const handler = (_evt: unknown, payload: { overlay: boolean }) => callback(payload)
    ipcRenderer.on('sync-overlay', handler)
    return () => ipcRenderer.removeListener('sync-overlay', handler)
  },
  onNavigateView: (callback: (payload: { view: 'home' | 'live' | string }) => void) => {
    const handler = (_evt: unknown, payload: { view: string }) => callback(payload)
    ipcRenderer.on('navigate-view', handler)
    return () => ipcRenderer.removeListener('navigate-view', handler)
  },
  onEndMeetingReview: (callback: () => void) => {
    ipcRenderer.on('end-meeting-review', callback)
    return () => ipcRenderer.removeListener('end-meeting-review', callback)
  },
  onShowLiveTranscript: (callback: () => void) => {
    ipcRenderer.on('show-live-transcript', callback)
    return () => ipcRenderer.removeListener('show-live-transcript', callback)
  }
})
