/** Cordis-free Chat presentation entry for native Clients. */
export { AssistantMarkdown } from './client/chat/AssistantMarkdown.tsx'
export { ReasoningRow } from './client/chat/ReasoningRow.tsx'
export { StatsPillsView } from './client/chat/StatsPillsView.tsx'
export { TurnNavigator } from './client/chat/TurnNavigator.tsx'
export { UserMessageView } from './client/chat/native-user-message.tsx'
export { ChatTranscriptColumn } from './client/chat/ChatTranscriptColumn.tsx'
export { toAssistantBlocks } from './native-event-projection.ts'
export { ChatView } from './native-chat-view.tsx'
export { createChatTranslator } from './native-locale.ts'
export type { ChatViewItem, ChatViewProps } from './native-chat-view.tsx'
export type {
  ChatAssistantBlock, ChatMessageImage, ChatMessageImagesProps, ChatRenderMessageImages,
  ChatTokenUsage, ChatTranslator, ChatTurnRailItem, ChatWindowStats,
} from './native-contracts.ts'
