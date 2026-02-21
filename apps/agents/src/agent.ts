import {
	Agent,
	type Connection,
	type ConnectionContext,
	type WSMessage,
} from "agents";
import migrations from "../drizzle/migrations";
import {
	drizzle,
	type DrizzleSqliteDODatabase,
} from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { conversationsTable } from "./db/schema";
import { eq } from "drizzle-orm";
import {
	smoothStream,
	streamText,
	type ModelMessage,
	type ToolSet,
	type StreamTextOnChunkCallback,
	type StreamTextOnFinishCallback,
	type StreamTextOnErrorCallback,
	generateText,
} from "ai";
import { gateway } from "@ai-sdk/gateway";
import { nanoid } from "nanoid";
import type { Chunk, StopStreamMessage, UserMessageContent } from "@repo/agent-kit";
import { MessageManager, StreamStateManager } from "./agent-modules";
import { getISO8601Timestamp, normalizeToolInput } from "./utils";

const MAX_CHAT_TURNS = 20;
const AGENT_MODEL = gateway("anthropic/claude-sonnet-4-6");

export class ParallelAgent extends Agent<Env> {
	storage: DurableObjectStorage;
	db: DrizzleSqliteDODatabase<any>;
	connections: Set<Connection> = new Set();

	messageManager: MessageManager;
	streamState: StreamStateManager;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.storage = ctx.storage;
		this.db = drizzle(this.storage, { logger: false });

		this.messageManager = new MessageManager(
			this.db,
			this.name,
			this.#generateSummary.bind(this),
		);
		this.streamState = new StreamStateManager(this.db, ctx, this.name);

		ctx.blockConcurrencyWhile(async () => {
			await migrate(this.db, migrations);

			const existingAlarm = await ctx.storage.getAlarm();
			if (!existingAlarm) {
				await ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
			}
		});
	}

	// =========================================================================
	// HTTP Request Handler
	// =========================================================================

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const pathnameParts = url.pathname.split("/");
		const resolvedPathname = "/" + pathnameParts.slice(4).join("/");

		console.log(
			`[Agent:${this.name}] ${request.method} ${resolvedPathname}`,
		);

		if (resolvedPathname.startsWith("/chat")) {
			return this.#handleChatRequest(
				request,
				resolvedPathname,
				pathnameParts,
			);
		}

		console.warn(
			`[Agent:${this.name}] Route not found: ${resolvedPathname}`,
		);
		return new Response("Not found", { status: 404 });
	}

	async #handleChatRequest(
		request: Request,
		_resolvedPathname: string,
		pathnameParts: string[],
	): Promise<Response> {
		if (request.method === "GET") {
			const conversationId = pathnameParts[pathnameParts.length - 1];
			if (!conversationId || conversationId === "chat") {
				return new Response("Invalid conversation ID", { status: 400 });
			}

			try {
				await this.#getConversation(conversationId);
				const messages =
					await this.messageManager.getMessages(conversationId);
				return new Response(JSON.stringify({ messages }), {
					status: 200,
				});
			} catch (error) {
				console.error("Error getting messages:", error);
				return new Response(
					JSON.stringify({ error: "Failed to get messages" }),
					{ status: 500 },
				);
			}
		} else if (request.method === "DELETE") {
			const conversationId = pathnameParts[pathnameParts.length - 1];
			if (!conversationId || conversationId === "chat") {
				return new Response("Invalid conversation ID", { status: 400 });
			}

			try {
				await this.#deleteConversation(conversationId);
				return new Response(JSON.stringify({ success: true }), {
					status: 200,
				});
			} catch (error) {
				console.error("Error deleting conversation:", error);
				return new Response(JSON.stringify({ success: false }), {
					status: 500,
				});
			}
		}

		return new Response("Not implemented", { status: 501 });
	}

	// =========================================================================
	// Alarm
	// =========================================================================

	async onAlarm(): Promise<void> {
		try {
			await this.streamState.cleanupOrphaned();
			await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
		} catch (error) {
			console.error(
				`[Agent:${this.name}] Error in alarm handler:`,
				error,
			);
			await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
		}
	}

	// =========================================================================
	// WebSocket Lifecycle
	// =========================================================================

	async onConnect(
		connection: Connection,
		ctx: ConnectionContext,
	): Promise<void> {
		const url = new URL(ctx.request.url || "");
		const resumeConversationId = url.searchParams.get(
			"resumeConversationId",
		);

		this.connections.add(connection);
		console.log(
			`[Agent:${this.name}] WebSocket connected (total: ${this.connections.size})`,
		);

		if (resumeConversationId) {
			await this.streamState.handleResume(
				connection,
				resumeConversationId,
				(id) => this.messageManager.getMessages(id),
			);
		}
	}

	async onClose(connection: Connection): Promise<void> {
		this.connections.delete(connection);
		console.log(
			`[Agent:${this.name}] WebSocket disconnected (remaining: ${this.connections.size})`,
		);
	}

	async onMessage(
		_connection: Connection,
		message: WSMessage,
	): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("Message must be a JSON string");
		}

		const parsed = JSON.parse(message) as Record<string, unknown>;

		// -- Stop stream --
		if (parsed.type === "stop-stream") {
			const stopMsg = parsed as unknown as StopStreamMessage;
			console.log(
				`[Agent:${this.name}] Stop stream requested: conversation=${stopMsg.conversationId}`,
			);
			await this.streamState.handleStop(
				stopMsg.conversationId,
				"user-cancelled",
				this.#broadcastToConnections.bind(this),
				async (convId, reason) => {
					await this.streamState.savePartialResponse(
						convId,
						reason,
						async (cid, userContent, responseMessages) => {
							await this.messageManager.saveMessages(
								cid,
								userContent,
								responseMessages,
							);
						},
					);
				},
			);
			return;
		}

		// -- Chat message --
		const chatMessage = parsed as {
			role: "user";
			content: UserMessageContent;
			conversationId?: string;
		};

		if (chatMessage.role !== "user" || !chatMessage.content) {
			console.warn(
				`[Agent:${this.name}] Invalid message format, expected user chat message`,
			);
			return;
		}

		const conversationId = chatMessage.conversationId || nanoid();
		console.log(
			`[Agent:${this.name}] Chat message received: conversation=${conversationId}`,
		);

		await this.#getConversation(conversationId);

		const originalContent = chatMessage.content;

		// Ensure content is in array form for the AI SDK
		const processedContent: UserMessageContent = originalContent;

		const messages = await this.messageManager.getMessages(
			conversationId,
			{
				role: "user",
				content: processedContent,
			},
		);

		let hasError = false;
		let errorMessage: string | null = null;

		await this.streamState.init(conversationId, originalContent);
		this.streamState.activeStreamConversationIds.add(conversationId);

		const abortController = new AbortController();
		this.streamState.streamAbortControllers.set(
			conversationId,
			abortController,
		);

		await this.#runAgent({
			conversationId,
			messages,
			tools: {},
			onChunk: (aiSdkChunk) => {
				const chunk = aiSdkChunk.chunk;
				let wsMessage: Chunk;

				if (chunk.type === "text-delta") {
					wsMessage = {
						type: "text-delta",
						text: chunk.text,
						conversationId,
						id: chunk.id,
					};
					this.streamState.updateText(conversationId, chunk.text);
				} else if (chunk.type === "tool-input-start") {
					wsMessage = {
						type: "tool-input-start",
						id: chunk.id,
						toolName: chunk.toolName,
						conversationId,
					};
					this.streamState.updatePendingTool(conversationId, {
						toolName: chunk.toolName,
						id: chunk.id,
					});
				} else if (chunk.type === "tool-call") {
					const normalizedInput = normalizeToolInput(chunk.input);

					wsMessage = {
						type: "tool-call",
						toolName: chunk.toolName,
						input: normalizedInput,
						conversationId,
						toolCallId: chunk.toolCallId,
						dynamic: true,
					};
					this.streamState.updateToolCall(conversationId, {
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						input: normalizedInput,
					});
				} else if (chunk.type === "tool-result") {
					const normalizedInput = normalizeToolInput(chunk.input);

					wsMessage = {
						type: "tool-result",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						conversationId,
						input: normalizedInput,
						output: chunk.output,
						dynamic: true,
					};
					this.streamState.updateToolResult(conversationId, {
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						output: chunk.output,
					});
				} else return;

				this.#broadcastToConnections(wsMessage);
			},
			onFinish: async (completion) => {
				const finishChunk: Chunk = {
					type: "finish",
					conversationId,
					finishReason: completion.finishReason,
					totalUsage: completion.totalUsage,
				};

				const completed = await this.streamState.complete(
					conversationId,
					"finished",
					finishChunk,
					this.#broadcastToConnections.bind(this),
				);

				if (!completed) {
					return;
				}

				console.log(
					`[Agent:${this.name}] Chat completed: conversation=${conversationId}, reason=${completion.finishReason}, tokens=${JSON.stringify(completion.totalUsage)}`,
				);

				try {
					if (hasError) {
						const errorResponseMessage: ModelMessage = {
							role: "assistant",
							content: `There was an error while processing your request: ${errorMessage || "Unknown error"}. Please try rephrasing your request or breaking it into smaller steps.`,
						};
						await this.messageManager.saveMessages(
							conversationId,
							originalContent,
							[errorResponseMessage],
						);
					} else {
						await this.messageManager.saveMessages(
							conversationId,
							originalContent,
							completion.response.messages,
						);
					}
				} catch (saveError) {
					console.error(
						`[Agent:${this.name}] Failed to save messages: conversation=${conversationId}`,
						saveError,
					);
				}
			},
			onError: async (error) => {
				hasError = true;
				const errorTimestamp = new Date().toISOString();
				console.error(
					`[Agent:${this.name}] Chat error: conversation=${conversationId}, timestamp=${errorTimestamp}`,
					error,
				);

				const errorChunk = {
					type: "error" as const,
					content: { errorAt: errorTimestamp },
					conversationId,
				};

				const completed = await this.streamState.complete(
					conversationId,
					"error",
					errorChunk,
					this.#broadcastToConnections.bind(this),
				);

				if (!completed) {
					return;
				}

				errorMessage =
					error instanceof Error
						? error.message
						: String(error || "Unknown error");
			},
			abortSignal: abortController.signal,
		});
	}

	// =========================================================================
	// Agent Runner
	// =========================================================================

	async #runAgent<TOOLS extends ToolSet>(options: {
		conversationId: string;
		messages: ModelMessage[];
		tools: TOOLS;
		systemPrompt?: string;
		onChunk: StreamTextOnChunkCallback<TOOLS>;
		onFinish: StreamTextOnFinishCallback<TOOLS>;
		onError: StreamTextOnErrorCallback;
		abortSignal?: AbortSignal;
	}) {
		const messagesWithSystem: ModelMessage[] = options.systemPrompt
			? [
					{ role: "system", content: options.systemPrompt },
					...options.messages,
				]
			: options.messages;

		const { textStream } = streamText({
			model: AGENT_MODEL,
			messages: messagesWithSystem,
			tools: options.tools,
			maxSteps: MAX_CHAT_TURNS,
			experimental_transform: smoothStream({
				delayInMs: 20,
				chunking: "word",
			}),
			temperature: 0.7,
			onChunk: options.onChunk,
			onFinish: options.onFinish,
			onError: options.onError,
			abortSignal: options.abortSignal,
		});

		try {
			for await (const _chunk of textStream) {
				// Consume the stream — callbacks handle the work
			}
		} catch (streamError) {
			if (options.abortSignal?.aborted) {
				console.log(
					`[Agent:${this.name}] Stream aborted: conversation=${options.conversationId}`,
				);
				return;
			}
			console.error(
				`[Agent:${this.name}] Stream iteration error: conversation=${options.conversationId}`,
				streamError,
			);
		}
	}

	// =========================================================================
	// Conversation Management
	// =========================================================================

	async #getConversation(
		conversationId: string,
		createIfNotExists?: true,
	): Promise<typeof conversationsTable.$inferSelect>;
	async #getConversation(
		conversationId: string,
		createIfNotExists: false,
	): Promise<typeof conversationsTable.$inferSelect | null>;
	async #getConversation(
		conversationId: string,
		createIfNotExists: boolean = true,
	): Promise<typeof conversationsTable.$inferSelect | null> {
		const conversation = await this.db
			.select()
			.from(conversationsTable)
			.where(eq(conversationsTable.id, conversationId))
			.execute();

		if (conversation.length === 0 && createIfNotExists) {
			const createdAt = getISO8601Timestamp();
			const result = await this.db
				.insert(conversationsTable)
				.values({
					id: conversationId,
					createdAt,
					updatedAt: createdAt,
				})
				.returning()
				.execute();
			if (result.length === 0) {
				throw new Error("Failed to create conversation");
			}
			return result[0]!;
		}

		if (conversation.length === 0 && !createIfNotExists) {
			return null;
		}

		return conversation[0]!;
	}

	async #deleteConversation(conversationId: string): Promise<void> {
		await this.db
			.delete(conversationsTable)
			.where(eq(conversationsTable.id, conversationId))
			.execute();
	}

	async #generateSummary(
		content: string,
		systemPrompt: string,
		maxTokens: number = 2048,
	): Promise<string> {
		try {
			const summary = await generateText({
				model: AGENT_MODEL,
				system: systemPrompt,
				prompt: `Content to summarize:\n${content}`,
				maxOutputTokens: maxTokens,
			});

			return (
				summary.text ||
				"Summary generation completed but no text was produced."
			);
		} catch (error) {
			console.error("Error generating summary:", error);
			return "Summary generation failed due to an error.";
		}
	}

	// =========================================================================
	// Broadcast
	// =========================================================================

	#broadcastToConnections(
		message:
			| Chunk
			| {
					type: "error";
					content: string | { errorAt: string };
					conversationId: string;
			  },
	): boolean {
		const messageStr = JSON.stringify(message);
		let delivered = false;
		for (const conn of this.connections) {
			try {
				conn.send(messageStr);
				delivered = true;
			} catch (error) {
				console.error(
					`[Agent:${this.name}] Failed to send to connection:`,
					error,
				);
				this.connections.delete(conn);
			}
		}
		return delivered;
	}
}
