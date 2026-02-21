import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { eq, and, sql } from "drizzle-orm";
import type { Connection } from "agents";
import type { ModelMessage, UserModelMessage } from "ai";

import { streamStatesTable } from "../db/schema";
import { getISO8601Timestamp } from "../utils";
import type {
	StreamResumeChunk,
	StreamToolResult,
	StreamPendingToolCall,
	StreamContentPart,
	StoppedChunk,
	Chunk,
	Message,
} from "@repo/agent-kit";

const STREAM_STATE_TTL_MS = 10 * 60 * 1000;

type BroadcastFn = (
	msg:
		| Chunk
		| {
				type: "error";
				content: string | { errorAt: string };
				conversationId: string;
		  },
) => boolean;

export class StreamStateManager {
	activeStreamConversationIds: Set<string> = new Set();
	streamAbortControllers: Map<string, AbortController> = new Map();
	userStoppedConversationIds: Set<string> = new Set();
	streamCompletionStates: Map<string, "finished" | "stopped" | "error"> =
		new Map();

	// In-memory buffers - writes are synchronous so no race condition
	private contentBuffers: Map<string, StreamContentPart[]> = new Map();
	private pendingToolBuffers: Map<string, StreamPendingToolCall | null> =
		new Map();
	private chunkCounters: Map<string, number> = new Map();

	// Flush scheduling
	private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private static readonly FLUSH_INTERVAL_MS = 1000;

	constructor(
		private db: DrizzleSqliteDODatabase<any>,
		private ctx: DurableObjectState,
		private agentName: string,
	) {}

	async init(
		conversationId: string,
		userMessageContent: UserModelMessage["content"],
	): Promise<void> {
		const now = getISO8601Timestamp();
		await this.db
			.insert(streamStatesTable)
			.values({
				conversationId,
				chunkIndex: 0,
				contentParts: [],
				pendingToolCall: null,
				userMessageContent,
				isActive: 1,
				startedAt: now,
				lastChunkAt: now,
			})
			.onConflictDoUpdate({
				target: streamStatesTable.conversationId,
				set: {
					chunkIndex: 0,
					contentParts: [],
					pendingToolCall: null,
					userMessageContent,
					isActive: 1,
					startedAt: now,
					lastChunkAt: now,
				},
			})
			.execute();

		// Initialize in-memory buffers
		this.contentBuffers.set(conversationId, []);
		this.pendingToolBuffers.set(conversationId, null);
		this.chunkCounters.set(conversationId, 0);

		console.log(
			`[Agent:${this.agentName}] Stream state initialized: conversation=${conversationId}`,
		);
	}

	updateText(conversationId: string, textDelta: string): void {
		const parts = this.contentBuffers.get(conversationId) || [];

		if (parts.length > 0 && parts[parts.length - 1]!.type === "text") {
			const last = parts[parts.length - 1] as {
				type: "text";
				text: string;
			};
			last.text += textDelta;
		} else {
			parts.push({ type: "text", text: textDelta });
		}

		this.contentBuffers.set(conversationId, parts);
		this.chunkCounters.set(
			conversationId,
			(this.chunkCounters.get(conversationId) || 0) + 1,
		);
		this.scheduleFlush(conversationId);
	}

	updatePendingTool(
		conversationId: string,
		pendingTool: StreamPendingToolCall,
	): void {
		this.pendingToolBuffers.set(conversationId, pendingTool);
		this.chunkCounters.set(
			conversationId,
			(this.chunkCounters.get(conversationId) || 0) + 1,
		);
		this.scheduleFlush(conversationId);
	}

	updateToolCall(
		conversationId: string,
		toolCall: { toolCallId: string; toolName: string; input: unknown },
	): void {
		const parts = this.contentBuffers.get(conversationId) || [];
		parts.push({
			type: "tool-call",
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
		});
		this.contentBuffers.set(conversationId, parts);
		this.pendingToolBuffers.set(conversationId, null);
		this.chunkCounters.set(
			conversationId,
			(this.chunkCounters.get(conversationId) || 0) + 1,
		);
		this.scheduleFlush(conversationId);
	}

	updateToolResult(
		conversationId: string,
		toolResult: StreamToolResult,
	): void {
		const parts = this.contentBuffers.get(conversationId) || [];
		parts.push({
			type: "tool-result",
			toolCallId: toolResult.toolCallId,
			toolName: toolResult.toolName,
			output: toolResult.output,
		});
		this.contentBuffers.set(conversationId, parts);
		this.pendingToolBuffers.set(conversationId, null);
		this.chunkCounters.set(
			conversationId,
			(this.chunkCounters.get(conversationId) || 0) + 1,
		);
		this.scheduleFlush(conversationId);
	}

	async clear(conversationId: string): Promise<void> {
		// Cancel pending flush
		const timer = this.flushTimers.get(conversationId);
		if (timer) {
			clearTimeout(timer);
			this.flushTimers.delete(conversationId);
		}

		// Clear in-memory state
		this.contentBuffers.delete(conversationId);
		this.pendingToolBuffers.delete(conversationId);
		this.chunkCounters.delete(conversationId);

		// Clear DB state
		await this.db
			.delete(streamStatesTable)
			.where(eq(streamStatesTable.conversationId, conversationId))
			.execute();

		console.log(
			`[Agent:${this.agentName}] Stream state cleared: conversation=${conversationId}`,
		);
	}

	async get(
		conversationId: string,
	): Promise<typeof streamStatesTable.$inferSelect | null> {
		const result = await this.db
			.select()
			.from(streamStatesTable)
			.where(
				and(
					eq(streamStatesTable.conversationId, conversationId),
					eq(streamStatesTable.isActive, 1),
				),
			)
			.execute();

		return result[0] || null;
	}

	private scheduleFlush(conversationId: string): void {
		if (this.flushTimers.has(conversationId)) return;

		const timer = setTimeout(() => {
			this.flushTimers.delete(conversationId);
			this.ctx.waitUntil(this.flush(conversationId));
		}, StreamStateManager.FLUSH_INTERVAL_MS);

		this.flushTimers.set(conversationId, timer);
	}

	async flush(conversationId: string): Promise<void> {
		const parts = this.contentBuffers.get(conversationId);
		const pendingTool = this.pendingToolBuffers.get(conversationId) ?? null;
		const chunkIndex = this.chunkCounters.get(conversationId) ?? 0;

		if (!parts) return;

		const now = getISO8601Timestamp();
		await this.db
			.update(streamStatesTable)
			.set({
				contentParts: parts,
				pendingToolCall: pendingTool,
				chunkIndex,
				lastChunkAt: now,
			})
			.where(eq(streamStatesTable.conversationId, conversationId))
			.execute();
	}

	async handleResume(
		connection: Connection,
		conversationId: string,
		getMessages: (conversationId: string) => Promise<ModelMessage[]>,
	): Promise<void> {
		await this.flush(conversationId);
		const streamState = await this.get(conversationId);

		if (!streamState) {
			console.log(
				`[Agent:${this.agentName}] No active stream to resume: conversation=${conversationId}`,
			);
			return;
		}

		const lastChunkTime = new Date(streamState.lastChunkAt).getTime();
		if (Date.now() - lastChunkTime > STREAM_STATE_TTL_MS) {
			console.log(
				`[Agent:${this.agentName}] Stream state is stale, clearing: conversation=${conversationId}`,
			);
			await this.clear(conversationId);
			return;
		}

		const previousMessages = await getMessages(conversationId);

		console.log(
			`[Agent:${this.agentName}] Resuming stream: conversation=${conversationId}, chunks=${streamState.chunkIndex}, previousMessages=${previousMessages.length}`,
		);

		const resumeChunk: StreamResumeChunk = {
			type: "stream-resume",
			conversationId,
			contentParts:
				(streamState.contentParts as StreamContentPart[]) || [],
			pendingToolCall:
				streamState.pendingToolCall as StreamPendingToolCall | null,
			chunkIndex: streamState.chunkIndex,
			previousMessages: previousMessages as Message[],
			userMessageContent:
				(streamState.userMessageContent as
					| UserModelMessage["content"]
					| undefined) || undefined,
		};

		connection.send(JSON.stringify(resumeChunk));
	}

	async complete(
		conversationId: string,
		reason: "finished" | "stopped" | "error",
		chunk:
			| Chunk
			| {
					type: "error";
					content: string | { errorAt: string };
					conversationId: string;
			  },
		broadcast: BroadcastFn,
		skipLockAcquisition: boolean = false,
	): Promise<boolean> {
		if (!skipLockAcquisition) {
			if (this.streamCompletionStates.has(conversationId)) {
				console.log(
					`[Agent:${this.agentName}] Stream already completed: conversation=${conversationId}, existing=${this.streamCompletionStates.get(conversationId)}, attempted=${reason}`,
				);
				return false;
			}
			this.streamCompletionStates.set(conversationId, reason);
		}

		const delivered = broadcast(chunk);

		if (!delivered) {
			console.warn(
				`[Agent:${this.agentName}] Completion chunk not delivered (no connections): conversation=${conversationId}, reason=${reason}`,
			);
		}

		try {
			await this.flush(conversationId);
			await this.clear(conversationId);
		} catch (error) {
			console.error(
				`[Agent:${this.agentName}] Failed to clear stream state: conversation=${conversationId}`,
				error,
			);
		}

		this.activeStreamConversationIds.delete(conversationId);
		this.streamAbortControllers.delete(conversationId);
		this.userStoppedConversationIds.delete(conversationId);

		setTimeout(() => {
			this.streamCompletionStates.delete(conversationId);
		}, 5000);

		console.log(
			`[Agent:${this.agentName}] Stream completed: conversation=${conversationId}, reason=${reason}, delivered=${delivered}`,
		);

		return true;
	}

	async handleStop(
		conversationId: string,
		reason: "user-cancelled" | "timeout",
		broadcast: BroadcastFn,
		savePartialResponse: (
			conversationId: string,
			reason: "user-cancelled" | "timeout",
		) => Promise<void>,
	): Promise<void> {
		this.userStoppedConversationIds.add(conversationId);

		const controller = this.streamAbortControllers.get(conversationId);
		if (controller) {
			controller.abort();
			console.log(
				`[Agent:${this.agentName}] Stream aborted: conversation=${conversationId}, reason=${reason}`,
			);
		}

		if (this.streamCompletionStates.has(conversationId)) {
			console.log(
				`[Agent:${this.agentName}] Stop stream lost race: conversation=${conversationId}, winner=${this.streamCompletionStates.get(conversationId)}`,
			);
			return;
		}
		this.streamCompletionStates.set(conversationId, "stopped");

		await savePartialResponse(conversationId, reason);

		const stoppedChunk: StoppedChunk = {
			type: "stopped",
			conversationId,
			reason,
		};
		await this.complete(
			conversationId,
			"stopped",
			stoppedChunk,
			broadcast,
			true,
		);
	}

	async savePartialResponse(
		conversationId: string,
		reason: "user-cancelled" | "timeout",
		saveMessages: (
			conversationId: string,
			userContent: UserModelMessage["content"],
			responseMessages: ModelMessage[],
		) => Promise<void>,
	): Promise<void> {
		try {
			await this.flush(conversationId);

			const streamState = await this.db
				.select()
				.from(streamStatesTable)
				.where(eq(streamStatesTable.conversationId, conversationId))
				.execute();

			if (streamState.length === 0) {
				console.warn(
					`[Agent:${this.agentName}] No stream state found for stopped conversation: ${conversationId}`,
				);
				return;
			}

			const state = streamState[0]!;
			const userMessageContent = state.userMessageContent as
				| UserModelMessage["content"]
				| null;
			const contentParts =
				(state.contentParts as StreamContentPart[]) || [];

			if (!userMessageContent) {
				console.warn(
					`[Agent:${this.agentName}] No user message content in stream state: ${conversationId}`,
				);
				return;
			}

			const responseMessages: ModelMessage[] = [];

			const assistantContentParts: Array<
				| { type: "text"; text: string }
				| {
						type: "tool-call";
						toolCallId: string;
						toolName: string;
						args: unknown;
				  }
			> = [];

			const toolResultParts: Array<{
				type: "tool-result";
				toolCallId: string;
				toolName: string;
				output: unknown;
			}> = [];

			const toolCallsWithResults = new Set<string>();

			for (const part of contentParts) {
				if (part.type === "tool-result") {
					toolCallsWithResults.add(part.toolCallId);
				}
			}

			for (const part of contentParts) {
				if (part.type === "text") {
					const lastPart =
						assistantContentParts[assistantContentParts.length - 1];
					if (lastPart && lastPart.type === "text") {
						lastPart.text += part.text;
					} else {
						assistantContentParts.push({
							type: "text",
							text: part.text,
						});
					}
				} else if (part.type === "tool-call") {
					if (toolCallsWithResults.has(part.toolCallId)) {
						assistantContentParts.push({
							type: "tool-call",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							args: part.input,
						});
					} else {
						console.log(
							`[Agent:${this.agentName}] Skipping orphaned tool call: conversation=${conversationId}, toolCallId=${part.toolCallId}, toolName=${part.toolName}`,
						);
					}
				} else if (part.type === "tool-result") {
					toolResultParts.push({
						type: "tool-result",
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: part.output,
					});
				}
			}

			const stopMessage =
				reason === "user-cancelled"
					? "\n\n[Response stopped by user]"
					: "\n\n[Response stopped due to timeout]";

			const lastAssistantPart =
				assistantContentParts[assistantContentParts.length - 1];
			if (lastAssistantPart && lastAssistantPart.type === "text") {
				lastAssistantPart.text += stopMessage;
			} else {
				assistantContentParts.push({
					type: "text",
					text: stopMessage.trim(),
				});
			}

			if (
				assistantContentParts.length === 1 &&
				assistantContentParts[0]!.type === "text"
			) {
				responseMessages.push({
					role: "assistant",
					content: (assistantContentParts[0] as { text: string })
						.text,
				});
			} else if (assistantContentParts.length > 0) {
				responseMessages.push({
					role: "assistant",
					content: assistantContentParts,
				} as ModelMessage);
			} else {
				responseMessages.push({
					role: "assistant",
					content:
						reason === "user-cancelled"
							? "[Response stopped by user]"
							: "[Response stopped due to timeout]",
				});
			}

			if (toolResultParts.length > 0) {
				responseMessages.push({
					role: "tool",
					content: toolResultParts,
				} as ModelMessage);
			}

			await saveMessages(
				conversationId,
				userMessageContent,
				responseMessages,
			);

			const hasText = assistantContentParts.some(
				(p) => p.type === "text" && p.text.trim().length > 0,
			);
			const toolCallCount = assistantContentParts.filter(
				(p) => p.type === "tool-call",
			).length;
			const toolResultCount = toolResultParts.length;

			console.log(
				`[Agent:${this.agentName}] Saved stopped response: conversation=${conversationId}, hasText=${hasText}, toolCalls=${toolCallCount}, toolResults=${toolResultCount}`,
			);
		} catch (error) {
			console.error(
				`[Agent:${this.agentName}] Failed to save partial response for conversation ${conversationId}:`,
				error,
			);
		}
	}

	async cleanupOrphaned(): Promise<number> {
		const cutoffTime = new Date(
			Date.now() - STREAM_STATE_TTL_MS,
		).toISOString();

		const orphaned = await this.db
			.select({ conversationId: streamStatesTable.conversationId })
			.from(streamStatesTable)
			.where(
				and(
					eq(streamStatesTable.isActive, 1),
					sql`${streamStatesTable.lastChunkAt} < ${cutoffTime}`,
				),
			)
			.execute();

		if (orphaned.length > 0) {
			console.log(
				`[Agent:${this.agentName}] Cleaning up ${orphaned.length} orphaned stream states`,
			);

			for (const { conversationId } of orphaned) {
				await this.clear(conversationId);
			}
		}

		return orphaned.length;
	}
}
