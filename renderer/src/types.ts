export type {
  AppNotice,
  AppSettings,
  Artifact,
  BootState,
  Bot,
  BotStatus,
  ChatMessage,
  CloudComputer,
  CloudRuntimeStatus,
  ComputerEvent,
  Connector,
  ConnectorStatus,
  DeviceClient,
  DevicePlatform,
  EventEnvelope,
  FederatedFact,
  FileNode,
  Handoff,
  InitPayload,
  JobTemplate,
  HistoryTurn,
  MemoryRow,
  ModelOption,
  NoticeKind,
  PendingPermission,
  Recording,
  RecordingStep,
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
