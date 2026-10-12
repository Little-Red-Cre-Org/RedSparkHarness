/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */

export { StateDot } from './StateDot.tsx'
export type { StateDotState } from './StateDot.tsx'
export { DisclosureRow } from './DisclosureRow.tsx'
export type { DisclosureRowProps } from './DisclosureRow.tsx'
export { Button } from './Button.tsx'
export type { ButtonVariant } from './Button.tsx'
export { Pill } from './Pill.tsx'
export { Tag } from './Tag.tsx'
export type { TagTone } from './Tag.tsx'
export { Switch } from './Switch.tsx'
export { Input } from './Input.tsx'
export { Menu } from './Menu.tsx'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel } from './Menu.tsx'
export { ModelPicker } from './ModelPicker.tsx'
export type {
  ModelPickerEffort, ModelPickerFailure, ModelPickerGroup, ModelPickerLocaleKey,
  ModelPickerModel, ModelPickerProps, ModelPickerSelection, ModelPickerState, ModelPickerTranslate,
} from './ModelPicker.tsx'
export { useAnchoredMaxHeight } from './useAnchoredMaxHeight.ts'
export { useAnchoredPosition } from './useAnchoredPosition.ts'
export type { AnchoredPositionOptions } from './useAnchoredPosition.ts'
export { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer.ts'
export { HoverCard } from './HoverCard.tsx'
export { Modal } from './Modal.tsx'
export { SettingsPanel } from './SettingsPanel.tsx'
export type { SettingsPanelProps, SettingsPanelRow } from './SettingsPanel.tsx'
export * from './models-settings/index.ts'
export { OnboardingSurface } from './OnboardingSurface.tsx'
export { OnboardingModal } from './OnboardingModal.tsx'
export { WelcomeNoticeView } from './WelcomeNoticeView.tsx'
export { ModelOnboardingView } from './ModelOnboardingView.tsx'
export type { ModelOnboardingCopyKey, ModelOnboardingProvider, ModelOnboardingViewProps } from './ModelOnboardingView.tsx'
export { RiskConfirmation } from './RiskConfirmation.tsx'
export type { RiskConfirmationProps } from './RiskConfirmation.tsx'
export { ConnectionIndicator } from './ConnectionIndicator.tsx'
export type { ConnectionIndicatorState } from './ConnectionIndicator.tsx'
export {
  ChatAssistantMessage, ChatComposerButton, ChatComposerCard, ChatComposerSelect, ChatComposerToolbar,
  ChatTranscript, ChatTurnActivity, ChatTurnGroup, ChatUserMessage, ChatWelcome,
} from './chat/ChatPresentation.tsx'
export { ChatReasoningDisclosure } from './chat/ChatReasoningDisclosure.tsx'
export { ChatMessageActionRow, ChatMessageActionMeta, ChatMessageCopyAction } from './chat/ChatMessageActions.tsx'
export { ChatContextMessage } from './chat/ChatContextMessage.tsx'
export type { ChatContextMessageProps } from './chat/ChatContextMessage.tsx'
export { ChatMascotHero } from './chat/ChatMascotHero.tsx'
export { FishLogo, FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from './FishLogo.tsx'
export { BrandWordmark } from './BrandWordmark.tsx'
export type { BrandWordmarkProps } from './BrandWordmark.tsx'
export { ReferenceIcon } from './ReferenceIcon.tsx'
export type { ReferenceIconKind, ReferenceIconProps } from './ReferenceIcon.tsx'
export { LinkIcon, classifyLinkPath } from './LinkIcon.tsx'
export type { LinkIconKind, LinkIconProps } from './LinkIcon.tsx'
export { FileTypeIcon, classifyFileType, fileExtension } from './FileTypeIcon.tsx'
export type {
  CodeFileType, FileType, FileTypeIconProps, FileTypeKind, FileTypeProjectContext,
} from './FileTypeIcon.tsx'
export { projectUserText, type UserTextReferences } from './user-text.tsx'
export { Tooltip } from './Tooltip.tsx'
export type { TooltipSide } from './Tooltip.tsx'
export { Toast } from './Toast.tsx'
export { fileSizeText } from './file-size.ts'
export { writeClipboard } from './clipboard.ts'
export { relativeTime } from './relative-time.ts'
export { rankByName } from './rank-by-name.ts'
export type { RelativeTime, RelativeTimeUnit } from './relative-time.ts'
export { ProjectRowItem, SearchResultItem, SessionNodeItem } from './workspace-rows/Rows.tsx'
export type {
  SessionPendingInteractionStatus, SessionRowNode, SessionSearchRow, WorkspaceGroupRow,
  WorkspaceRowKey, WorkspaceRowTranslate,
} from './workspace-rows/types.ts'
export { WorkspaceSectionEmpty, WorkspaceSectionHeader } from './workspace-rows/WorkspaceSection.tsx'
export { workspaceLabel } from './workspace-rows/workspace-label.ts'
export { DirectoryBrowser } from './DirectoryBrowser.tsx'
export type {
  DirectoryBrowserEntry, DirectoryBrowserKey, DirectoryBrowserListing, DirectoryBrowserProps, DirectoryBrowserTranslate,
} from './DirectoryBrowser.tsx'
export { SidebarPathBar } from './SidebarPathBar.tsx'
export { JsonTree } from './JsonTree.tsx'
export type { JsonTreeProps, JsonTreeLabels } from './JsonTree.tsx'
export { TerminalBlock, DEFAULT_TERMINAL_MAX_LINES } from './TerminalBlock.tsx'
export type { TerminalBlockProps, TerminalBlockLabels } from './TerminalBlock.tsx'
export { ReadBlock, DEFAULT_READ_MAX_LINES } from './ReadBlock.tsx'
export type { ReadBlockProps, ReadBlockLine, ReadBlockLabels } from './ReadBlock.tsx'
export { DiffBlock, DEFAULT_DIFF_MAX_LINES, diffTotals } from './DiffBlock.tsx'
export type { DiffBlockProps, DiffHunk, DiffBlockLabels } from './DiffBlock.tsx'
export { SearchBlock, DEFAULT_SEARCH_MAX_LINES } from './SearchBlock.tsx'
export type {
  SearchBlockProps, SearchMatchesBlockProps, SearchPathsBlockProps, SearchFileGroup, SearchBlockLineMatch,
  SearchBlockLabels,
} from './SearchBlock.tsx'
export { WebBlock } from './WebBlock.tsx'
export type {
  WebBlockProps, WebSearchBlockProps, WebFetchBlockProps, WebSourceView, WebBlockLabels,
} from './WebBlock.tsx'
export { CodeBlock } from './markdown/CodeBlock.tsx'
export type { CodeBlockProps } from './markdown/CodeBlock.tsx'
export { JsonBlock } from './markdown/JsonBlock.tsx'
export { MarkdownText } from './markdown/MarkdownText.tsx'
export type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownLabels, MarkdownPathImages } from './markdown/MarkdownText.tsx'
export { extractMarkdownPlainText } from './markdown/plain-text.ts'
export type { MarkdownPlainTextMode, MarkdownPlainTextOptions } from './markdown/plain-text.ts'
export * from './icons/index.tsx'
