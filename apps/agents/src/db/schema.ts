import { sql } from "drizzle-orm";
import {
	index,
	int,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Stream States (ephemeral streaming state, needs DO locality)
// ---------------------------------------------------------------------------

export const streamStatesTable = sqliteTable(
	"stream_states",
	{
		/** Conversation ID - only one active stream per conversation */
		conversationId: text().primaryKey(),

		/** Current chunk sequence number */
		chunkIndex: int().notNull().default(0),

		/**
		 * Ordered array of content parts preserving the exact stream sequence.
		 * Contains interleaved text and tool-result parts in the order they were streamed.
		 */
		contentParts: text({ mode: "json" }).notNull().default([]),

		/**
		 * Current pending tool call (if any).
		 * Format: { toolName: string; id: string } | null
		 */
		pendingToolCall: text({ mode: "json" }),

		/**
		 * The user message content that triggered this stream.
		 * Stored here because messages are only persisted to DB on stream completion.
		 */
		userMessageContent: text({ mode: "json" }),

		/** Whether the stream is still active (1) or completed/errored (0) */
		isActive: int().notNull().default(1),

		/** ISO 8601 UTC when stream started */
		startedAt: text().notNull(),

		/** ISO 8601 UTC of last chunk received */
		lastChunkAt: text().notNull(),
	},
	(table) => [index("stream_states_active_index").on(table.isActive)],
);

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversationsTable = sqliteTable(
	"conversations",
	{
		/** nanoid */
		id: text().primaryKey(),

		/**
		 * 0 -> active session
		 * 1 -> inactive, summarizable session
		 */
		active: int().notNull().default(0),

		/**
		 * Lightweight working context
		 * (NOT long-term memory, safe to overwrite)
		 */
		context: text(),

		/**
		 * Number of compactions performed on the conversation
		 */
		compactionCount: int().notNull().default(0),

		/**
		 * Lightweight summary of the conversation
		 * (For inactive sessions)
		 */
		summary: text(),

		/** ISO 8601 UTC */
		createdAt: text().notNull(),

		/** ISO 8601 UTC */
		updatedAt: text().notNull(),

		/**
		 * When set, the LLM should no longer append messages
		 * but summaries can still be generated
		 */
		closedAt: text(),
	},
	(table) => [index("conversations_active_index").on(table.active)],
);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const messagesTable = sqliteTable(
	"messages",
	{
		/** Conversation */
		conversationId: text()
			.notNull()
			.references(() => conversationsTable.id, {
				onDelete: "cascade",
			}),

		/**
		 * Strict ordering within a conversation
		 * Starts at 1, increments monotonically
		 */
		sequence: int().notNull(),

		/**
		 * system = system framing
		 * user   = explicit user input
		 * assistant  = LLM output
		 * tool   = tool call input + output
		 * compaction = summarization message of all previous content
		 * error = error message
		 */
		role: text().notNull(),

		/** Actual content sent to / produced by the LLM */
		content: text({ mode: "json" }).notNull(),

		/** Optional structured metadata */
		metadata: text({ mode: "json" }),

		/** Input tokens consumed for this message */
		inputTokens: int(),

		/** Output tokens generated for this message */
		outputTokens: int(),

		/** ISO 8601 UTC */
		sentAt: text().notNull(),
	},
	(table) => [
		/** Composite primary key */
		primaryKey({
			columns: [table.conversationId, table.sequence],
		}),

		/** Fast conversation replay */
		index("messages_conversation_index").on(table.conversationId),

		/** Role-based filtering */
		index("messages_role_index").on(table.role),

		/** Ordered scans (critical for LLM context building) */
		index("messages_conversation_sequence_index").on(
			table.conversationId,
			table.sequence,
		),
	],
);
