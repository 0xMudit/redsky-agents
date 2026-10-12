export type {
  AppNotice,
  AppSettings,
  Artifact,
  BootState,
  Bot,
  BotStatus,
  ChatMessage,
  ComputerEvent,
  Connector,
  ConnectorStatus,
  EventEnvelope,
  FileNode,
  InitPayload,
  JobTemplate,
  HistoryTurn,
  MemoryRow,
  ModelOption,
  NoticeKind,
  PendingPermission,
  RedSkyApi,
  ReviewMode,
  Room,
  Routine,
  RunDiff,
  SearchHit,
  SetupCheck,
} from '../../shared/types'

declare global {
  interface Window {
    redsky: import('../../shared/types').RedSkyApi
  }
}
