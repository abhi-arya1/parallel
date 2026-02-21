import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { pruneMessages, type ModelMessage, type UserModelMessage } from "ai";

import { conversationsTable, messagesTable } from "../db/schema";
import {
	getISO8601Timestamp,
	contentArrayToString,
	normalizeMessageContent,
} from "../utils";
import { estimateTokens, estimateMessagesTokens } from "@repo/agent-kit";

const COMPACTION_THRESHOLD_TOKENS = 128_000;

const SUMMARY_PROMPT =
	"You are a conversation summarizer. Provide a concise summary of the conversation that preserves key context, decisions, and any important details. Focus on what would be needed to continue the conversation meaningfully.";

type GenerateSummaryFn = (
	content: string,
	systemPrompt: string,
	maxTokens?: number,
) => Promise<string>;

export class MessageManager {
	constructor(
		private db: DrizzleSqliteDODatabase<any>,
		private agentName: string,
		private generateSummary: GenerateSummaryFn,
	) {}

	isToolCallPart(
		part: unknown,
	): part is { type: string; toolCallId: string; [key: string]: unknown } {
		return (
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			(part.type === "tool-call" ||
				part.type === "tool-use" ||
				part.type === "tool_use") &&
			"toolCallId" in part
		);
	}

	isToolResultPart(
		part: unknown,
	): part is { type: string; toolCallId: string; [key: string]: unknown } {
		return (
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			(part.type === "tool-result" || part.type === "tool_result") &&
			"toolCallId" in part
		);
	}

	sanitizeOrphanedToolCalls(messages: ModelMessage[]): ModelMessage[] {
		const result: ModelMessage[] = [];

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!;

			if (message.role !== "assistant") {
				result.push(message);
				continue;
			}

			if (!Array.isArray(message.content)) {
				result.push(message);
				continue;
			}

			const toolCallIds = new Set<string>();
			for (const part of message.content) {
				if (this.isToolCallPart(part)) {
					toolCallIds.add(part.toolCallId as string);
				}
			}

			if (toolCallIds.size === 0) {
				result.push(message);
				continue;
			}

			const nextMessage = messages[i + 1];
			const toolResultIds = new Set<string>();

			if (
				nextMessage &&
				nextMessage.role === "tool" &&
				Array.isArray(nextMessage.content)
			) {
				for (const part of nextMessage.content) {
					if (this.isToolResultPart(part)) {
						toolResultIds.add(part.toolCallId as string);
					}
				}
			}

			const orphanedToolCallIds = new Set<string>();
			for (const toolCallId of toolCallIds) {
				if (!toolResultIds.has(toolCallId)) {
					orphanedToolCallIds.add(toolCallId);
				}
			}

			if (orphanedToolCallIds.size === 0) {
				result.push(message);
				continue;
			}

			console.log(
				`[Agent:${this.agentName}] Removing ${orphanedToolCallIds.size} orphaned tool call(s): ${[...orphanedToolCallIds].join(", ")}`,
			);

			const filteredContent = message.content.filter((part) => {
				if (this.isToolCallPart(part)) {
					return !orphanedToolCallIds.has(part.toolCallId as string);
				}
				return true;
			});

			const interruptionNote = {
				type: "text" as const,
				text: "\n\n[A previous tool call was interrupted and could not complete.]",
			};

			if (filteredContent.length > 0) {
				const lastPart = filteredContent[filteredContent.length - 1];
				if (
					typeof lastPart === "object" &&
					lastPart !== null &&
					"type" in lastPart &&
					lastPart.type === "text"
				) {
					(lastPart as { type: "text"; text: string }).text +=
						interruptionNote.text;
				} else {
					filteredContent.push(interruptionNote);
				}

				result.push({
					role: "assistant",
					content: filteredContent,
				} as ModelMessage);
			} else {
				result.push({
					role: "assistant",
					content:
						"[A previous tool call was interrupted and could not complete.]",
				});
			}
		}

		return result;
	}

	repairToolMessageOrder(messages: ModelMessage[]): ModelMessage[] {
		const result: ModelMessage[] = [];

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!;

			if (
				message.role === "assistant" &&
				Array.isArray(message.content)
			) {
				const toolCallIds = new Set<string>();
				for (const part of message.content) {
					if (this.isToolCallPart(part)) {
						toolCallIds.add((part as any).toolCallId);
					}
				}

				if (toolCallIds.size > 0) {
					result.push(message);

					let toolMessageIndex = -1;
					for (let j = i + 1; j < messages.length; j++) {
						const candidate = messages[j]!;
						if (
							candidate.role === "tool" &&
							Array.isArray(candidate.content)
						) {
							const hasMatchingResult = candidate.content.some(
								(part: any) =>
									this.isToolResultPart(part) &&
									toolCallIds.has(part.toolCallId),
							);
							if (hasMatchingResult) {
								toolMessageIndex = j;
								break;
							}
						}
					}

					if (toolMessageIndex > i + 1) {
						console.log(
							`[Agent:${this.agentName}] Reordering: moving tool message from index ${toolMessageIndex} to immediately after assistant at ${i}`,
						);
						result.push(messages[toolMessageIndex]!);

						for (let j = i + 1; j < toolMessageIndex; j++) {
							result.push(messages[j]!);
						}

						i = toolMessageIndex;
					} else if (toolMessageIndex === i + 1) {
						result.push(messages[i + 1]!);
						i++;
					}
					continue;
				}
			}

			result.push(message);
		}

		return result;
	}

	async getMessages(conversationId: string): Promise<ModelMessage[]>;
	async getMessages(
		conversationId: string,
		newUserMessage: ModelMessage,
	): Promise<ModelMessage[]>;
	async getMessages(
		conversationId: string,
		newUserMessage: ModelMessage,
		options: {
			schema?: "ai";
			prune?: boolean;
			excludeSystemMessages?: boolean;
			compact?: boolean;
		},
	): Promise<ModelMessage[]>;
	async getMessages(
		conversationId: string,
		newUserMessage?: ModelMessage,
		options: {
			schema?: "ai";
			prune?: boolean;
			excludeSystemMessages?: boolean;
			compact?: boolean;
		} = {},
	): Promise<ModelMessage[]> {
		const {
			prune = true,
			excludeSystemMessages = true,
			compact = true,
		} = options;

		if (!newUserMessage) {
			const messages = await this.db
				.select()
				.from(messagesTable)
				.where(eq(messagesTable.conversationId, conversationId))
				.orderBy(messagesTable.sequence)
				.execute();

			const modelMessages: ModelMessage[] = [];

			for (const message of messages) {
				if (message.role === "system") {
					continue;
				}

				const content = message.content as any;
				let modelMessage: ModelMessage | null = null;

				if (message.role === "user") {
					modelMessage = {
						role: "user",
						content: content as UserModelMessage["content"],
					};
				} else if (message.role === "assistant") {
					modelMessage = {
						role: "assistant",
						content: content as Extract<
							ModelMessage,
							{ role: "assistant" }
						>["content"],
					};
				} else if (message.role === "tool") {
					modelMessage = {
						role: "tool",
						content: content as Extract<
							ModelMessage,
							{ role: "tool" }
						>["content"],
					};
				}

				if (modelMessage) {
					modelMessages.push(modelMessage);
				}
			}

			return modelMessages;
		}

		const lastCompaction = await this.db
			.select({
				sequence: messagesTable.sequence,
				content: messagesTable.content,
			})
			.from(messagesTable)
			.where(
				and(
					eq(messagesTable.conversationId, conversationId),
					eq(messagesTable.role, "compaction"),
				),
			)
			.orderBy(desc(messagesTable.sequence))
			.limit(1)
			.execute();

		const conditions = [eq(messagesTable.conversationId, conversationId)];

		if (lastCompaction.length > 0) {
			conditions.push(
				gte(messagesTable.sequence, lastCompaction[0]!.sequence),
			);
		}

		const messages = await this.db
			.select()
			.from(messagesTable)
			.where(and(...conditions))
			.orderBy(messagesTable.sequence)
			.execute();

		const systemMessages: ModelMessage[] = [];
		const otherMessages: ModelMessage[] = [];

		for (const message of messages) {
			const content = message.content as any;
			const normalizedContent = normalizeMessageContent(content);
			let modelMessage: ModelMessage | null = null;

			if (message.role === "user") {
				modelMessage = {
					role: "user",
					content: normalizedContent as UserModelMessage["content"],
				};
			} else if (message.role === "assistant") {
				modelMessage = {
					role: "assistant",
					content: normalizedContent as Extract<
						ModelMessage,
						{ role: "assistant" }
					>["content"],
				};
			} else if (message.role === "tool") {
				modelMessage = {
					role: "tool",
					content: normalizedContent as Extract<
						ModelMessage,
						{ role: "tool" }
					>["content"],
				};
			} else if (message.role === "system") {
				modelMessage = {
					role: "system",
					content: contentArrayToString(content),
				};
			}

			if (modelMessage) {
				if (message.role === "system") {
					systemMessages.push(modelMessage);
				} else {
					otherMessages.push(modelMessage);
				}
			}
		}

		if (lastCompaction.length > 0 && otherMessages.length > 0) {
			const compactionContent = lastCompaction[0]!.content as
				| string
				| Array<unknown>;
			const compactionText =
				typeof compactionContent === "string"
					? compactionContent
					: contentArrayToString(compactionContent);

			const firstUserMessageIndex = otherMessages.findIndex(
				(msg) => msg.role === "user",
			);

			if (firstUserMessageIndex !== -1) {
				const firstUserMessage =
					otherMessages[firstUserMessageIndex]!;
				const userContent = firstUserMessage.content;

				const compactionPart = {
					type: "text" as const,
					text: `<context_compaction>This is a recap of the conversation until this point, to preserve your context window:\n${compactionText}\n</context_compaction>`,
				};

				otherMessages[firstUserMessageIndex] = {
					role: "user",
					content: [
						compactionPart,
						...((Array.isArray(userContent)
							? userContent
							: [
									{ type: "text" as const, text: String(userContent) },
								]) as UserModelMessage["content"]),
					] as UserModelMessage["content"],
				};
			}
		}

		let result: ModelMessage[];
		if (excludeSystemMessages) {
			result = otherMessages;
		} else {
			result = [...systemMessages, ...otherMessages];
		}

		if (prune) {
			result = pruneMessages({
				messages: result,
				reasoning: "before-last-message",
				toolCalls: "before-last-3-messages",
				emptyMessages: "remove",
			});
		}

		result = this.repairToolMessageOrder(result);
		result = this.sanitizeOrphanedToolCalls(result);

		if (compact && newUserMessage) {
			const completedAndCompactedMessages = await this.compactMessages(
				conversationId,
				result,
				newUserMessage,
			);
			return completedAndCompactedMessages;
		}

		return [...result, newUserMessage];
	}

	async saveMessages(
		conversationId: string,
		userMessageContent: UserModelMessage["content"],
		responseMessages: Array<ModelMessage>,
	) {
		const lastMessageItem = await this.db
			.select({ sequence: messagesTable.sequence })
			.from(messagesTable)
			.where(eq(messagesTable.conversationId, conversationId))
			.orderBy(desc(messagesTable.sequence))
			.limit(1)
			.execute();

		let currentIndex = 1;
		if (lastMessageItem.length !== 0) {
			currentIndex = lastMessageItem[0]!.sequence + 1;
		}

		const userTokenCount = estimateTokens(userMessageContent);
		const newMessages: (typeof messagesTable.$inferInsert)[] = [
			{
				conversationId,
				sequence: currentIndex,
				role: "user",
				content: userMessageContent,
				sentAt: getISO8601Timestamp(),
				inputTokens: userTokenCount,
				outputTokens: 0,
			},
		];

		currentIndex++;

		for (const message of responseMessages) {
			const messageTokens = estimateTokens(message.content);
			newMessages.push({
				conversationId,
				sequence: currentIndex,
				role: message.role,
				content: message.content,
				sentAt: getISO8601Timestamp(),
				inputTokens: message.role === "user" ? messageTokens : 0,
				outputTokens: message.role === "assistant" ? messageTokens : 0,
			});
			currentIndex++;
		}

		for (const message of newMessages) {
			await this.db.insert(messagesTable).values(message).execute();
		}
	}

	async compactMessages(
		conversationId: string,
		messages: ModelMessage[],
		newUserMessage: ModelMessage,
	): Promise<ModelMessage[]> {
		const tokens = estimateMessagesTokens(messages, 50, 2000);

		console.info("Current token count: ", tokens);

		if (tokens < COMPACTION_THRESHOLD_TOKENS) {
			return [...messages, newUserMessage];
		}

		console.warn(
			"Compacting messages to preserve context window: ",
			tokens,
		);

		const messagesText = messages
			.map(
				(m) =>
					`${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
			)
			.join("\n\n");

		const summaryText = await this.generateSummary(
			messagesText,
			SUMMARY_PROMPT,
			8192,
		);

		const compactionPart = {
			type: "text" as const,
			text: `<context_compaction>This is a recap of the conversation until this point, to preserve your context window:\n${summaryText}\n</context_compaction>`,
		};

		const newUserMessageWithSummary: ModelMessage = {
			role: "user",
			content: [
				compactionPart,
				...((Array.isArray(newUserMessage.content)
					? newUserMessage.content
					: [
							{
								type: "text" as const,
								text: String(newUserMessage.content),
							},
						]) as UserModelMessage["content"]),
			] as UserModelMessage["content"],
		};

		await this.db
			.update(conversationsTable)
			.set({
				compactionCount: sql`${conversationsTable.compactionCount} + 1`,
				summary: summaryText,
				updatedAt: getISO8601Timestamp(),
			})
			.where(eq(conversationsTable.id, conversationId))
			.execute();

		return [newUserMessageWithSummary];
	}
}
