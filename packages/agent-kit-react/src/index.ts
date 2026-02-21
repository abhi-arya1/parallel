export { useChat } from "./use-chat";
export type { UseChatOptions, UseChatReturn } from "./use-chat";

export {
	createOnMessageHandler,
	convertAgentChunkToMessage,
	convertLoadedMessagesToUIState,
} from "./message-handler";
export type { PendingToolCall } from "./message-handler";

export {
	getContentArray,
	isTextPart,
	getTextFromPart,
	extractPendingToolCalls,
	extractToolResultIds,
	convertFailedToolCallsToErrors,
	removePendingToolCalls,
	hasPendingToolCall,
	updatePendingToolCallRef,
} from "./chat-ops";
