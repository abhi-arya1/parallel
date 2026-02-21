"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { Message, UserMessageContent } from "@repo/agent-kit";
import {
	createOnMessageHandler,
	type PendingToolCall,
} from "./message-handler";

const CONNECT_TIMEOUT = 5000;
const STUCK_TIMEOUT_MS = 10_000;
const TOOL_TIMEOUT_MS = 90_000;

export interface UseChatOptions {
	/**
	 * WebSocket connection (e.g., from agents/react useAgent hook).
	 * Must have send(), readyState, OPEN, CLOSING, CLOSED, reconnect(),
	 * and addEventListener/removeEventListener.
	 */
	connection: {
		send: (data: string) => void;
		readyState: number;
		OPEN: number;
		CLOSING: number;
		CLOSED: number;
		reconnect: () => void;
		addEventListener: (event: string, handler: (...args: any[]) => void) => void;
		removeEventListener: (event: string, handler: (...args: any[]) => void) => void;
	};

	/** Unique conversation identifier */
	conversationId: string | null;

	/** Pre-loaded messages for instant hydration */
	initialMessages?: Message[];

	/** Called when stream is resumed after reconnection */
	onStreamResume?: () => void;

	/** Called on connection error */
	onConnectionError?: (error: Error) => void;
}

export interface UseChatReturn {
	messages: Message[];
	/** True from when message is sent until first chunk arrives */
	isLoading: boolean;
	/** True from when message is sent until stream finishes */
	isStreaming: boolean;
	pendingToolCallRef: React.MutableRefObject<PendingToolCall>;

	sendMessage: (text: string) => Promise<void>;
	clearChat: () => Promise<void>;
	stopChat: () => void;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

/**
 * React hook for chat functionality with a Parallel agent.
 * Handles WebSocket message routing, stream state, and message management.
 */
export const useChat = ({
	connection,
	conversationId,
	initialMessages,
	onStreamResume,
	onConnectionError,
}: UseChatOptions): UseChatReturn => {
	const [messages, setMessages] = useState<Message[]>(
		initialMessages ?? [],
	);
	const [isLoading, setIsLoading] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);

	const isLoadingRef = useRef<boolean>(false);
	const isStreamingRef = useRef<boolean>(false);
	const pendingToolCallRef = useRef<PendingToolCall>(null);
	const lastSyncedConversationRef = useRef<string | null>(null);
	const streamingConversationIdRef = useRef<string | null>(null);
	const lastChunkTimeRef = useRef<number>(Date.now());

	// Create the onMessage handler
	const agentOnMessage = useMemo(() => {
		const handler = createOnMessageHandler({
			conversationId,
			isLoadingRef,
			isStreamingRef,
			pendingToolCallRef,
			setMessages,
			setIsLoading,
			setIsStreaming,
			onStreamComplete: () => {
				streamingConversationIdRef.current = null;
			},
			onStreamResume,
		});

		return (message: { data: string }) => {
			lastChunkTimeRef.current = Date.now();
			handler(message);
		};
	}, [conversationId, onStreamResume]);

	// Register the message handler on the connection
	useEffect(() => {
		const handler = (event: any) => {
			agentOnMessage({ data: event.data ?? event });
		};
		connection.addEventListener("message", handler);
		return () => {
			connection.removeEventListener("message", handler);
		};
	}, [connection, agentOnMessage]);

	// Sync messages from initialMessages
	useEffect(() => {
		if (!conversationId) return;
		if (initialMessages === undefined) return;

		const isNewConversation =
			lastSyncedConversationRef.current !== conversationId;

		if (isNewConversation || initialMessages.length > 0) {
			setMessages(initialMessages);
			lastSyncedConversationRef.current = conversationId;
		}
	}, [initialMessages, conversationId]);

	// Helper to reset state when connection is lost
	const handleConnectionLoss = useCallback(() => {
		isLoadingRef.current = false;
		isStreamingRef.current = false;
		setIsLoading(false);
		setIsStreaming(false);
		streamingConversationIdRef.current = null;

		setMessages((prev) => {
			const lastMessage = prev[prev.length - 1];
			if (lastMessage?.role === "assistant" && !lastMessage.complete) {
				const existingContent = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [];

				const filteredContent = existingContent.filter(
					(part) =>
						typeof part !== "object" ||
						!("type" in part) ||
						part.type !== "pending-tool-call",
				);

				return [
					...prev.slice(0, -1),
					{
						...lastMessage,
						content: [
							...filteredContent,
							{
								type: "error" as const,
								content: "Connection lost - response incomplete",
							},
						],
						complete: true,
					},
				];
			}
			return prev;
		});
	}, []);

	// Send message
	const sendMessage = useCallback(
		async (messageText: string) => {
			if (!messageText.trim() || !conversationId) return;

			if (isStreamingRef.current) {
				console.warn("Please wait for the current response to finish");
				return;
			}

			isLoadingRef.current = true;
			isStreamingRef.current = true;
			setIsLoading(true);
			setIsStreaming(true);

			streamingConversationIdRef.current = conversationId;

			// Check if connection is not ready
			if (connection.readyState !== connection.OPEN) {
				if (
					connection.readyState === connection.CLOSING ||
					connection.readyState === connection.CLOSED
				) {
					connection.reconnect();
				}

				const connected = await new Promise<boolean>((resolve) => {
					const timeout = setTimeout(
						() => resolve(false),
						CONNECT_TIMEOUT,
					);

					const onOpen = () => {
						clearTimeout(timeout);
						connection.removeEventListener("open", onOpen);
						resolve(true);
					};

					if (connection.readyState === connection.OPEN) {
						clearTimeout(timeout);
						resolve(true);
						return;
					}

					connection.addEventListener("open", onOpen);
				});

				if (!connected) {
					isLoadingRef.current = false;
					isStreamingRef.current = false;
					setIsLoading(false);
					setIsStreaming(false);
					onConnectionError?.(
						new Error("Unable to connect to agent"),
					);
					return;
				}
			}

			const userContent: UserMessageContent = [
				{ type: "text", text: messageText },
			];

			const userMessage: Message = {
				role: "user",
				content: userContent,
				complete: true,
			};

			setMessages((prevMessages) => {
				const lastMessage = prevMessages[prevMessages.length - 1];
				if (
					lastMessage &&
					lastMessage.role === "user" &&
					typeof lastMessage.content === "object" &&
					Array.isArray(lastMessage.content) &&
					lastMessage.content[0]?.type === "text" &&
					(lastMessage.content[0] as { text?: string })?.text ===
						messageText
				) {
					isLoadingRef.current = false;
					isStreamingRef.current = false;
					setIsLoading(false);
					setIsStreaming(false);
					return prevMessages;
				}
				return [...prevMessages, userMessage];
			});

			try {
				lastChunkTimeRef.current = Date.now();

				connection.send(
					JSON.stringify({
						role: "user",
						content: userContent,
						conversationId,
					}),
				);
			} catch (error) {
				console.error("Error sending message:", error);
				isLoadingRef.current = false;
				isStreamingRef.current = false;
				setIsLoading(false);
				setIsStreaming(false);
			}
		},
		[connection, conversationId, onConnectionError],
	);

	// Clear chat
	const clearChat = useCallback(async () => {
		if (!conversationId) return;

		// We send a DELETE request to the agent's HTTP endpoint
		// The caller can override this behavior by wrapping clearChat
		setMessages([]);
	}, [conversationId]);

	// Stop chat
	const stopChat = useCallback(() => {
		if (!conversationId || !isStreamingRef.current) return;

		try {
			connection.send(
				JSON.stringify({
					type: "stop-stream",
					conversationId,
				}),
			);
		} catch (error) {
			console.warn("Failed to send stop signal:", error);
			handleConnectionLoss();
		}
	}, [conversationId, connection, handleConnectionLoss]);

	// Timeout detection
	useEffect(() => {
		if (!isStreaming) return;

		const checkInterval = setInterval(() => {
			const timeSinceLastChunk = Date.now() - lastChunkTimeRef.current;
			const isWaitingOnTool = pendingToolCallRef.current !== null;
			const timeoutMs = isWaitingOnTool
				? TOOL_TIMEOUT_MS
				: STUCK_TIMEOUT_MS;

			if (timeSinceLastChunk > timeoutMs && isStreamingRef.current) {
				console.warn(
					`[useChat] Chat stuck for ${timeSinceLastChunk}ms (tool pending: ${isWaitingOnTool}), auto-stopping`,
				);

				handleConnectionLoss();

				try {
					if (conversationId) {
						connection.send(
							JSON.stringify({
								type: "stop-stream",
								conversationId,
							}),
						);
					}
				} catch {
					// Ignore - connection may be dead
				}
			}
		}, 2_000);

		return () => clearInterval(checkInterval);
	}, [isStreaming, conversationId, connection, handleConnectionLoss]);

	// WebSocket close handler
	useEffect(() => {
		if (!isStreaming || !connection) return;

		const handleClose = () => {
			if (isStreamingRef.current) {
				console.warn(
					`[useChat] WebSocket closed while streaming, resetting state`,
				);
				handleConnectionLoss();
			}
		};

		connection.addEventListener("close", handleClose);

		return () => {
			connection.removeEventListener("close", handleClose);
		};
	}, [isStreaming, connection, handleConnectionLoss]);

	return {
		messages,
		isLoading,
		isStreaming,
		pendingToolCallRef,
		sendMessage,
		clearChat,
		stopChat,
		setMessages,
	};
};
