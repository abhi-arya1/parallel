import type {
	Chunk,
	Message,
	ExtendedAssistantContent,
} from "@repo/agent-kit";
import type { ToolResultPart, ModelMessage } from "ai";
import React, { startTransition } from "react";
import {
	getContentArray,
	isTextPart,
	getTextFromPart,
	convertFailedToolCallsToErrors,
	removePendingToolCalls,
	hasPendingToolCall,
	updatePendingToolCallRef,
} from "./chat-ops";

export type PendingToolCall = Extract<
	Chunk,
	{ type: "tool-input-start" }
> | null;

export const convertAgentChunkToMessage = (
	chunk: Chunk,
	previousMessage?: Message,
): Message => {
	if (!chunk || typeof chunk !== "object" || chunk.type === undefined) {
		console.error(
			"Invalid chunk passed to convertAgentChunkToMessage:",
			chunk,
		);
		return {
			role: "assistant",
			content: [
				{
					type: "error" as const,
					content: "Invalid message format received",
				},
			],
			complete: true,
		};
	}

	const baseMessage: Message =
		previousMessage?.role === "assistant"
			? previousMessage
			: {
					role: "assistant",
					content: [],
					complete: false,
				};

	if (chunk.type === "text-delta") {
		if (typeof chunk.text !== "string") {
			return {
				...baseMessage,
				content: [
					...(Array.isArray(baseMessage.content)
						? baseMessage.content
						: []),
					{
						type: "error" as const,
						content: "Invalid text delta received",
					},
				],
				complete: false,
			};
		}

		try {
			const errorToolResults = convertFailedToolCallsToErrors(
				baseMessage.content,
			);
			const filteredContent = removePendingToolCalls(baseMessage.content);

			const updatedContent = [...filteredContent, ...errorToolResults];

			const hasFailedToolCalls = errorToolResults.length > 0;

			if (hasFailedToolCalls) {
				updatedContent.push({
					type: "text" as const,
					text: chunk.text,
				});
			} else {
				const lastItem = filteredContent[filteredContent.length - 1];

				if (lastItem && isTextPart(lastItem)) {
					updatedContent[filteredContent.length - 1] = {
						type: "text" as const,
						text: getTextFromPart(lastItem) + chunk.text,
					};
				} else {
					updatedContent.push({
						type: "text" as const,
						text: chunk.text,
					});
				}
			}

			return {
				...baseMessage,
				content: updatedContent,
				complete: false,
			};
		} catch (error) {
			console.error("Error processing text-delta chunk:", error, chunk);
			return {
				...baseMessage,
				content: [
					...(Array.isArray(baseMessage.content)
						? baseMessage.content
						: []),
					{
						type: "error" as const,
						content: "Failed to process text update",
					},
				],
				complete: false,
			};
		}
	}

	if (chunk.type === "tool-input-start") {
		try {
			if (hasPendingToolCall(baseMessage.content)) {
				return baseMessage;
			}

			const originalContent = getContentArray(baseMessage.content);
			return {
				...baseMessage,
				content: [
					...originalContent,
					{
						type: "pending-tool-call" as const,
						toolName: chunk.toolName,
						id: chunk.id,
					},
				],
			};
		} catch (error) {
			console.error(
				"Error processing tool-input-start chunk:",
				error,
				chunk,
			);
			return baseMessage;
		}
	}

	if (chunk.type === "tool-result") {
		try {
			const filteredContent = removePendingToolCalls(baseMessage.content);
			return {
				...baseMessage,
				content: [
					...filteredContent,
					{
						type: "tool-result",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						output: chunk.output as ToolResultPart["output"],
					},
				],
			};
		} catch (error) {
			console.error("Error processing tool-result chunk:", error, chunk);
			return baseMessage;
		}
	}

	if (chunk.type === "finish") {
		try {
			const errorToolResults = convertFailedToolCallsToErrors(
				baseMessage.content,
			);
			const filteredContent = removePendingToolCalls(baseMessage.content);

			return {
				...baseMessage,
				content: [...filteredContent, ...errorToolResults],
				complete: true,
			};
		} catch (error) {
			console.error("Error processing finish chunk:", error, chunk);
			return {
				...baseMessage,
				complete: true,
			};
		}
	}

	if (chunk.type === "error") {
		try {
			const errorToolResults = convertFailedToolCallsToErrors(
				baseMessage.content,
			);
			const filteredContent = removePendingToolCalls(baseMessage.content);

			const errorContent =
				"content" in chunk && typeof chunk.content === "string"
					? chunk.content
					: "Unknown error";

			return {
				...baseMessage,
				content: [
					...filteredContent,
					...errorToolResults,
					{
						type: "error" as const,
						content: errorContent,
					},
				],
				complete: true,
			};
		} catch (error) {
			console.error("Error processing error chunk:", error, chunk);
			return {
				...baseMessage,
				content: [
					...(Array.isArray(baseMessage.content)
						? baseMessage.content
						: []),
					{
						type: "error" as const,
						content: "An error occurred",
					},
				],
				complete: true,
			};
		}
	}

	if (chunk.type === "tool-call") {
		return baseMessage;
	}

	if (chunk.type === "stream-resume" || chunk.type === "stopped") {
		return baseMessage;
	}

	console.warn("Unknown chunk type:", chunk);
	return baseMessage;
};

// ---------------------------------------------------------------------------
// Helpers for converting loaded DB messages to UI state
// ---------------------------------------------------------------------------

const isToolCallPart = (
	part: unknown,
): part is {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
} => {
	return (
		typeof part === "object" &&
		part !== null &&
		"type" in part &&
		part.type === "tool-call" &&
		"toolCallId" in part &&
		"toolName" in part
	);
};

const isToolResultPart = (
	part: unknown,
): part is {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: unknown;
} => {
	return (
		typeof part === "object" &&
		part !== null &&
		"type" in part &&
		part.type === "tool-result" &&
		"toolCallId" in part &&
		"toolName" in part &&
		"output" in part
	);
};

type AllowedContentPart =
	| { type: "text"; text: string }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			output: ToolResultPart["output"];
	  };

const normalizeContentPart = (part: unknown): AllowedContentPart | null => {
	if (typeof part === "string") {
		return { type: "text" as const, text: part };
	}

	if (
		typeof part === "object" &&
		part !== null &&
		"type" in part &&
		part.type === "text" &&
		"text" in part
	) {
		return part as { type: "text"; text: string };
	}

	if (isToolResultPart(part)) {
		return {
			type: "tool-result" as const,
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			output: part.output as ToolResultPart["output"],
		};
	}

	return null;
};

const getAssistantContentArray = (
	content: Extract<ModelMessage, { role: "assistant" }>["content"],
): readonly unknown[] => {
	if (Array.isArray(content)) {
		return content;
	}
	if (typeof content === "string" && content.length > 0) {
		return [{ type: "text", text: content }];
	}
	return [];
};

const getToolContentArray = (
	content: Extract<ModelMessage, { role: "tool" }>["content"],
): readonly unknown[] => {
	return Array.isArray(content) ? content : [];
};

export const convertLoadedMessagesToUIState = (
	loadedMessages: ModelMessage[],
): Message[] => {
	const result: Message[] = [];
	let currentAssistant: Message | null = null;
	const pendingToolCalls = new Map<
		string,
		{ toolCallId: string; toolName: string }
	>();

	for (const msg of loadedMessages) {
		if (msg.role === "user") {
			if (currentAssistant) {
				result.push(currentAssistant);
				currentAssistant = null;
				pendingToolCalls.clear();
			}
			result.push({
				...msg,
				complete: true,
			});
		} else if (msg.role === "assistant") {
			const contentArray = getAssistantContentArray(msg.content);
			const newParts: AllowedContentPart[] = [];

			for (const part of contentArray) {
				if (isToolCallPart(part)) {
					pendingToolCalls.set(part.toolCallId, {
						toolCallId: part.toolCallId,
						toolName: part.toolName,
					});
				} else {
					const normalized = normalizeContentPart(part);
					if (normalized) {
						newParts.push(normalized);
					}
				}
			}

			if (currentAssistant) {
				const existingParts = Array.isArray(currentAssistant.content)
					? (currentAssistant.content as AllowedContentPart[])
					: [];
				currentAssistant.content = [
					...existingParts,
					...newParts,
				] as ExtendedAssistantContent;
			} else {
				currentAssistant = {
					role: "assistant",
					content: newParts as ExtendedAssistantContent,
					complete: true,
				};
			}
		} else if (msg.role === "tool") {
			if (!currentAssistant) {
				continue;
			}

			const contentArray = getToolContentArray(msg.content);
			const toolResults: AllowedContentPart[] = [];

			for (const part of contentArray) {
				if (isToolResultPart(part)) {
					toolResults.push({
						type: "tool-result" as const,
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: part.output as ToolResultPart["output"],
					});
					pendingToolCalls.delete(part.toolCallId);
				}
			}

			if (toolResults.length === 0) {
				continue;
			}

			const existingParts = Array.isArray(currentAssistant.content)
				? (currentAssistant.content as AllowedContentPart[])
				: [];
			currentAssistant.content = [
				...existingParts,
				...toolResults,
			] as ExtendedAssistantContent;
		}
	}

	if (currentAssistant) {
		result.push(currentAssistant);
	}

	return result;
};

/**
 * Creates an onMessage handler for the agent WebSocket connection.
 * Each handler is scoped to a specific conversationId to ensure messages
 * from different conversations don't cross-contaminate between chat UIs.
 */
export const createOnMessageHandler = ({
	conversationId,
	isLoadingRef,
	isStreamingRef,
	pendingToolCallRef,
	setMessages,
	setIsLoading,
	setIsStreaming,
	onStreamComplete,
	onStreamSuccess,
	onStreamResume,
}: {
	conversationId: string | null;
	isLoadingRef: React.MutableRefObject<boolean>;
	isStreamingRef?: React.MutableRefObject<boolean>;
	pendingToolCallRef: React.MutableRefObject<PendingToolCall>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setIsLoading?: React.Dispatch<React.SetStateAction<boolean>>;
	setIsStreaming?: React.Dispatch<React.SetStateAction<boolean>>;
	onStreamComplete?: () => void;
	onStreamSuccess?: () => void;
	onStreamResume?: () => void;
}) => {
	return (wsMessage: { data: string | Chunk }) => {
		try {
			let chunk: Chunk;
			try {
				chunk = (
					typeof wsMessage.data === "string"
						? JSON.parse(wsMessage.data)
						: wsMessage.data
				) as Chunk;
			} catch (parseError) {
				console.error(
					"Failed to parse agent update:",
					parseError,
					wsMessage.data,
				);
				return;
			}

			if (!conversationId || !("conversationId" in chunk)) {
				return;
			}
			if (chunk.conversationId !== conversationId) {
				return;
			}

			// When first chunk arrives, clear isLoading (but keep isStreaming true)
			if (isLoadingRef.current) {
				isLoadingRef.current = false;
				setIsLoading?.(false);
			}

			// When stream finishes, errors, or is stopped, clear isStreaming
			if (
				"type" in chunk &&
				(chunk.type === "finish" ||
					chunk.type === "error" ||
					chunk.type === "stopped")
			) {
				if (isStreamingRef) {
					isStreamingRef.current = false;
				}
				setIsStreaming?.(false);
				onStreamComplete?.();

				if (chunk.type === "finish") {
					onStreamSuccess?.();
				}
			}

			// Handle finish chunk
			if ("type" in chunk && chunk.type === "finish") {
				startTransition(() => {
					setMessages((prevMessages) => {
						const lastMessage =
							prevMessages[prevMessages.length - 1];
						if (
							lastMessage?.role === "assistant" &&
							lastMessage.complete
						) {
							return prevMessages;
						}
						try {
							const convertedMessage =
								convertAgentChunkToMessage(chunk, lastMessage);
							const isUpdatingLastMessage =
								lastMessage &&
								lastMessage.role === "assistant" &&
								!lastMessage.complete;

							if (isUpdatingLastMessage) {
								return [
									...prevMessages.slice(0, -1),
									convertedMessage,
								];
							}
							return [...prevMessages, convertedMessage];
						} catch (conversionError) {
							console.error(
								"Failed to convert finish chunk:",
								conversionError,
								chunk,
							);
							return prevMessages;
						}
					});
				});
				return;
			}

			// Handle stopped chunk
			if ("type" in chunk && chunk.type === "stopped") {
				startTransition(() => {
					setMessages((prevMessages) => {
						const lastMessage =
							prevMessages[prevMessages.length - 1];

						const errorContent =
							chunk.reason === "user-cancelled"
								? "Response stopped"
								: "Connection lost - response incomplete";

						if (
							lastMessage?.role === "assistant" &&
							!lastMessage.complete
						) {
							const existingContent = Array.isArray(
								lastMessage.content,
							)
								? lastMessage.content
								: [];

							const filteredContent = existingContent.filter(
								(part) =>
									typeof part !== "object" ||
									!("type" in part) ||
									part.type !== "pending-tool-call",
							);

							return [
								...prevMessages.slice(0, -1),
								{
									...lastMessage,
									content: [
										...filteredContent,
										{
											type: "error" as const,
											content: errorContent,
										},
									],
									complete: true,
								},
							];
						}

						if (lastMessage?.role === "user") {
							return [
								...prevMessages,
								{
									role: "assistant" as const,
									content: [
										{
											type: "error" as const,
											content: errorContent,
										},
									],
									complete: true,
								},
							];
						}

						return prevMessages;
					});
				});
				return;
			}

			// Handle error chunk
			if ("type" in chunk && chunk.type === "error") {
				startTransition(() => {
					setMessages((prevMessages) => {
						const lastMessage =
							prevMessages[prevMessages.length - 1];
						if (
							lastMessage?.role === "assistant" &&
							lastMessage.complete
						) {
							return prevMessages;
						}
						try {
							const convertedMessage =
								convertAgentChunkToMessage(chunk, lastMessage);
							const isUpdatingLastMessage =
								lastMessage &&
								lastMessage.role === "assistant" &&
								!lastMessage.complete;

							if (isUpdatingLastMessage) {
								return [
									...prevMessages.slice(0, -1),
									convertedMessage,
								];
							}
							return [...prevMessages, convertedMessage];
						} catch (conversionError) {
							console.error(
								"Failed to convert error chunk:",
								conversionError,
								chunk,
							);
							return prevMessages;
						}
					});
				});
				return;
			}

			updatePendingToolCallRef(chunk, pendingToolCallRef);

			// Handle stream-resume
			if ("type" in chunk && chunk.type === "stream-resume") {
				startTransition(() => {
					try {
						const previousMessages = chunk.previousMessages
							? convertLoadedMessagesToUIState(
									chunk.previousMessages as ModelMessage[],
								)
							: [];

						const currentUserMessage: Message | null =
							chunk.userMessageContent
								? {
										role: "user",
										content: chunk.userMessageContent,
										complete: true,
									}
								: null;

						const streamingContent: Array<
							| { type: "text"; text: string }
							| {
									type: "tool-result";
									toolCallId: string;
									toolName: string;
									output: ToolResultPart["output"];
							  }
							| {
									type: "pending-tool-call";
									toolName: string;
									id: string;
							  }
						> = [];

						if (
							chunk.contentParts &&
							chunk.contentParts.length > 0
						) {
							for (const part of chunk.contentParts) {
								if (part.type === "text") {
									streamingContent.push({
										type: "text",
										text: part.text,
									});
								} else if (part.type === "tool-result") {
									streamingContent.push({
										type: "tool-result",
										toolCallId: part.toolCallId,
										toolName: part.toolName,
										output: part.output as ToolResultPart["output"],
									});
								}
							}
						}

						if (chunk.pendingToolCall) {
							streamingContent.push({
								type: "pending-tool-call",
								toolName: chunk.pendingToolCall.toolName,
								id: chunk.pendingToolCall.id,
							});
						}

						const streamingAssistantMessage: Message = {
							role: "assistant",
							content:
								streamingContent as ExtendedAssistantContent,
							complete: false,
						};

						const restoredMessages: Message[] = [
							...previousMessages,
							...(currentUserMessage
								? [currentUserMessage]
								: []),
							streamingAssistantMessage,
						];

						console.log(
							`[StreamResume] Restored ${previousMessages.length} previous messages + ${currentUserMessage ? "user message + " : ""}streaming assistant with ${streamingContent.length} parts`,
						);

						setMessages(restoredMessages);

						if (isStreamingRef) {
							isStreamingRef.current = true;
						}
						setIsStreaming?.(true);

						onStreamResume?.();
					} catch (error) {
						console.error(
							"Error processing stream-resume:",
							error,
							chunk,
						);
					}
				});
				return;
			}

			// Default: text-delta, tool-input-start, etc.
			startTransition(() => {
				try {
					setMessages((prevMessages) => {
						try {
							const lastMessage =
								prevMessages[prevMessages.length - 1];

							if (
								lastMessage?.role === "assistant" &&
								lastMessage.complete
							) {
								return prevMessages;
							}

							const convertedMessage =
								convertAgentChunkToMessage(chunk, lastMessage);

							const isUpdatingLastMessage =
								lastMessage &&
								lastMessage.role === "assistant" &&
								!lastMessage.complete;

							if (isUpdatingLastMessage) {
								return [
									...prevMessages.slice(0, -1),
									convertedMessage,
								];
							}

							return [...prevMessages, convertedMessage];
						} catch (conversionError) {
							console.error(
								"Failed to convert chunk:",
								conversionError,
								chunk,
							);
							const errorMessage: Message = {
								role: "assistant",
								content: [
									{
										type: "error" as const,
										content:
											"Failed to process message. Please try again.",
									},
								],
								complete: true,
							};
							return [...prevMessages, errorMessage];
						}
					});
				} catch (stateError) {
					console.error("Error updating messages state:", stateError);
				}
			});
		} catch (error) {
			console.error("Unexpected error in onMessage handler:", error);
		}
	};
};
