import { createSignal, createContext, useContext, ParentComponent, Accessor, createEffect, onMount } from 'solid-js'
import { useSettings, type Locale } from './stores/settings'

export type { Locale }

export interface Translations {
  // App
  appName: string
  // Mode
  simpleMode: string
  proMode: string
  // Panel
  addPanel: string
  addAgentPanel: string
  addConsolePanel: string
  addExplorerPanel: string
  addEditorPanel: string
  minimize: string
  maximize: string
  close: string
  // Status bar
  panelCount: string
  ready: string
  // Empty states
  startConversation: string
  typeToBegin: string
  noMCPServers: string
  addServerToExtend: string
  // Chat
  you: string
  agent: string
  typeMessage: string
  agentThinking: string
  send: string
  // Settings
  settings: string
  provider: string
  providerDesc: string
  permission: string
  permissionDesc: string
  compaction: string
  compactionDesc: string
  voice: string
  voiceDesc: string
  theme: string
  themeDesc: string
  language: string
  languageDesc: string
  languageConfig: string
  chinese: string
  english: string
  // Provider
  providerConfig: string
  aiProvider: string
  apiKey: string
  baseUrl: string
  model: string
  testConnection: string
  // Permission
  permissionConfig: string
  permissionMode: string
  permissive: string
  defaultMode: string
  askAll: string
  planMode: string
  dangerousTools: string
  allow: string
  deny: string
  ask: string
  // Compaction
  compactionConfig: string
  tokenThreshold: string
  compactionWarning: string
  protectedTools: string
  protectedToolsHint: string
  // Voice
  voiceConfig: string
  enableVoice: string
  recognitionEngine: string
  webSpeech: string
  whisperLocal: string
  shortcut: string
  autoSend: string
  autoSendHint: string
  showWaveform: string
  // Theme
  themeConfig: string
  systemTheme: string
  darkTheme: string
  lightTheme: string
  fontSize: string
  fontFamily: string
  resetDefaults: string
  // MCP
  mcpServers: string
  add: string
  connected: string
  connecting: string
  disconnected: string
  error: string
  edit: string
  delete: string
  addMCPServer: string
  serverName: string
  transportType: string
  stdio: string
  httpSSE: string
  commandStdio: string
  urlHttp: string
  cancel: string
  addServer: string
  // Voice input
  voiceInput: string
  listening: string
  processing: string
  microphoneDenied: string
  noSpeechDetected: string
  speechNotSupported: string
  // Errors
  configureApiKey: string
  unknownError: string
  // Console
  systemInitialized: string
  waitingForInput: string
  // Explorer
  explorer: string
  openFolder: string
  noFolderOpened: string
  clickToOpenFolder: string
  // Terminal
  terminal: string
  newTab: string
  clearTerminal: string
}

const translations: Record<Locale, Translations> = {
  zh: {
    appName: 'Hybrid Agent',
    simpleMode: '简洁模式',
    proMode: '专业模式',
    addPanel: '添加面板',
    addAgentPanel: '添加 Agent 面板',
    addConsolePanel: '添加 Console 面板',
    addExplorerPanel: '添加 Explorer 面板',
    addEditorPanel: '添加 Editor 面板',
    minimize: '最小化',
    maximize: '最大化',
    close: '关闭',
    panelCount: '面板数',
    ready: '就绪',
    startConversation: '开始对话',
    typeToBegin: '输入消息开始与 Agent 对话',
    noMCPServers: '暂无 MCP 服务器',
    addServerToExtend: '添加服务器以扩展 Agent 能力',
    you: '你',
    agent: 'Agent',
    typeMessage: '输入消息...',
    agentThinking: 'Agent 思考中...',
    send: '发送',
    settings: '设置',
    provider: 'Provider',
    providerDesc: 'API 配置',
    permission: 'Permission',
    permissionDesc: '权限设置',
    compaction: 'Compaction',
    compactionDesc: '会话压缩',
    voice: 'Voice',
    voiceDesc: '语音输入',
    theme: 'Theme',
    themeDesc: '主题外观',
    language: 'Language',
    languageDesc: '语言设置',
    languageConfig: '语言配置',
    chinese: '中文',
    english: 'English',
    providerConfig: 'Provider 配置',
    aiProvider: 'Provider',
    apiKey: 'API Key',
    baseUrl: 'Base URL',
    model: 'Model',
    testConnection: '测试连接',
    permissionConfig: '权限配置',
    permissionMode: '权限模式',
    permissive: 'Permissive - 允许所有操作',
    defaultMode: 'Default - 安全操作直接允许',
    askAll: 'Ask All - 所有操作询问',
    planMode: 'Plan - 只读模式',
    dangerousTools: '危险工具',
    allow: '允许',
    deny: '拒绝',
    ask: '询问',
    compactionConfig: '压缩配置',
    tokenThreshold: 'Token 阈值',
    compactionWarning: '警告阈值 (%)',
    protectedTools: '保护工具',
    protectedToolsHint: '这些工具不会被裁剪',
    voiceConfig: '语音配置',
    enableVoice: '启用语音输入',
    recognitionEngine: '识别引擎',
    webSpeech: 'Web Speech API',
    whisperLocal: 'Whisper.cpp (本地)',
    shortcut: '快捷键',
    autoSend: '自动发送',
    autoSendHint: '无需按回车自动发送',
    showWaveform: '显示波形动画',
    themeConfig: '主题配置',
    systemTheme: '跟随系统',
    darkTheme: '深色',
    lightTheme: '浅色',
    fontSize: '字体大小',
    fontFamily: '字体',
    resetDefaults: '恢复默认',
    mcpServers: 'MCP 服务器',
    add: '添加',
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '已断开',
    error: '错误',
    edit: '编辑',
    delete: '删除',
    addMCPServer: '添加 MCP 服务器',
    serverName: '服务器名称',
    transportType: '传输类型',
    stdio: 'Stdio',
    httpSSE: 'HTTP/SSE',
    commandStdio: '命令 (stdio)',
    urlHttp: 'URL (http/sse)',
    cancel: '取消',
    addServer: '添加服务器',
    voiceInput: '语音输入',
    listening: '聆听中...',
    processing: '处理中...',
    microphoneDenied: '麦克风访问被拒绝',
    noSpeechDetected: '未检测到语音',
    speechNotSupported: '语音识别不支持',
    configureApiKey: '请在设置中配置 API Key',
    unknownError: '未知错误',
    systemInitialized: '系统已初始化',
    waitingForInput: '等待输入...',
    explorer: '文件浏览器',
    openFolder: '打开文件夹',
    noFolderOpened: '未打开文件夹',
    clickToOpenFolder: '点击打开文件夹',
    terminal: '终端',
    newTab: '新标签',
    clearTerminal: '清空终端',
  },
  en: {
    appName: 'Hybrid Agent',
    simpleMode: 'Simple',
    proMode: 'Pro',
    addPanel: 'Add Panel',
    addAgentPanel: 'Add Agent Panel',
    addConsolePanel: 'Add Console Panel',
    addExplorerPanel: 'Add Explorer Panel',
    addEditorPanel: 'Add Editor Panel',
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
    panelCount: 'Panels',
    ready: 'Ready',
    startConversation: 'Start a conversation',
    typeToBegin: 'Type a message to begin chatting with the agent',
    noMCPServers: 'No MCP Servers',
    addServerToExtend: 'Add a server to extend agent capabilities',
    you: 'You',
    agent: 'Agent',
    typeMessage: 'Type a message...',
    agentThinking: 'Agent is thinking...',
    send: 'Send',
    settings: 'Settings',
    provider: 'Provider',
    providerDesc: 'API Configuration',
    permission: 'Permission',
    permissionDesc: 'Permission Settings',
    compaction: 'Compaction',
    compactionDesc: 'Session Compaction',
    voice: 'Voice',
    voiceDesc: 'Voice Input',
    theme: 'Theme',
    themeDesc: 'Appearance',
    language: 'Language',
    languageDesc: 'Language Settings',
    languageConfig: 'Language Configuration',
    chinese: 'Chinese',
    english: 'English',
    providerConfig: 'Provider Configuration',
    aiProvider: 'Provider',
    apiKey: 'API Key',
    baseUrl: 'Base URL',
    model: 'Model',
    testConnection: 'Test Connection',
    permissionConfig: 'Permission Configuration',
    permissionMode: 'Permission Mode',
    permissive: 'Permissive - Allow all operations',
    defaultMode: 'Default - Safe operations allowed directly',
    askAll: 'Ask All - Ask for all operations',
    planMode: 'Plan - Read-only mode',
    dangerousTools: 'Dangerous Tools',
    allow: 'Allow',
    deny: 'Deny',
    ask: 'Ask',
    compactionConfig: 'Compaction Configuration',
    tokenThreshold: 'Token Threshold',
    compactionWarning: 'Warning Threshold (%)',
    protectedTools: 'Protected Tools',
    protectedToolsHint: 'These tools will not be pruned',
    voiceConfig: 'Voice Configuration',
    enableVoice: 'Enable Voice Input',
    recognitionEngine: 'Recognition Engine',
    webSpeech: 'Web Speech API',
    whisperLocal: 'Whisper.cpp (Local)',
    shortcut: 'Shortcut',
    autoSend: 'Auto-send',
    autoSendHint: 'Send without pressing Enter',
    showWaveform: 'Show Waveform Animation',
    themeConfig: 'Theme Configuration',
    systemTheme: 'System',
    darkTheme: 'Dark',
    lightTheme: 'Light',
    fontSize: 'Font Size',
    fontFamily: 'Font Family',
    resetDefaults: 'Reset to Defaults',
    mcpServers: 'MCP Servers',
    add: 'Add',
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    error: 'Error',
    edit: 'Edit',
    delete: 'Delete',
    addMCPServer: 'Add MCP Server',
    serverName: 'Server Name',
    transportType: 'Transport Type',
    stdio: 'Stdio',
    httpSSE: 'HTTP/SSE',
    commandStdio: 'Command (for stdio)',
    urlHttp: 'URL (for http/sse)',
    cancel: 'Cancel',
    addServer: 'Add Server',
    voiceInput: 'Voice input',
    listening: 'Listening...',
    processing: 'Processing...',
    microphoneDenied: 'Microphone access denied',
    noSpeechDetected: 'No speech detected',
    speechNotSupported: 'Speech recognition not supported',
    configureApiKey: 'Please configure API key in Settings',
    unknownError: 'Unknown error',
    systemInitialized: 'System initialized',
    waitingForInput: 'Waiting for input...',
    explorer: 'Explorer',
    openFolder: 'Open Folder',
    noFolderOpened: 'No folder opened',
    clickToOpenFolder: 'Click to open a folder',
    terminal: 'Terminal',
    newTab: 'New Tab',
    clearTerminal: 'Clear Terminal',
  },
}

interface I18nContextValue {
  locale: Accessor<Locale>
  setLocale: (locale: Locale) => void
  t: Translations
}

const I18nContext = createContext<I18nContextValue>()

export const I18nProvider: ParentComponent = (props) => {
  const settings = useSettings()

  const setLocale = (newLocale: Locale) => {
    settings.updateLanguage(newLocale)
  }

  const value: I18nContextValue = {
    locale: () => settings.settings.language,
    setLocale,
    get t() {
      return translations[settings.settings.language]
    },
  }

  return (
    <I18nContext.Provider value={value}>
      {props.children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}
