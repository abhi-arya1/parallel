import {
  index,
  int,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const streamStatesTable = sqliteTable(
  "stream_states",
  {
    conversationId: text().primaryKey(),
    chunkIndex: int().notNull().default(0),
    contentParts: text({ mode: "json" }).notNull().default([]),
    pendingToolCall: text({ mode: "json" }),
    userMessageContent: text({ mode: "json" }),
    isActive: int().notNull().default(1),
    startedAt: text().notNull(),
    lastChunkAt: text().notNull(),
  },
  (table) => [index("stream_states_active_index").on(table.isActive)],
);

export const conversationsTable = sqliteTable(
  "conversations",
  {
    id: text().primaryKey(),
    active: int().notNull().default(0),
    context: text(),
    compactionCount: int().notNull().default(0),
    summary: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    closedAt: text(),
  },
  (table) => [index("conversations_active_index").on(table.active)],
);

export const messagesTable = sqliteTable(
  "messages",
  {
    conversationId: text()
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    sequence: int().notNull(),
    role: text().notNull(),
    content: text({ mode: "json" }).notNull(),
    metadata: text({ mode: "json" }),
    inputTokens: int(),
    outputTokens: int(),
    sentAt: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.sequence] }),
    index("messages_conversation_index").on(table.conversationId),
    index("messages_role_index").on(table.role),
    index("messages_conversation_sequence_index").on(
      table.conversationId,
      table.sequence,
    ),
  ],
);

export const activityTable = sqliteTable(
  "activity",
  {
    id: text().primaryKey(),
    type: text().notNull(),
    content: text({ mode: "json" }),
    streamId: text(),
    isPartial: int().default(0),
    createdAt: int().notNull(),
  },
  (table) => [
    index("activity_created_index").on(table.createdAt),
    index("activity_stream_index").on(table.streamId),
  ],
);

export const findingsTable = sqliteTable(
  "findings",
  {
    id: text().primaryKey(),
    content: text().notNull(),
    cellType: text().default("markdown"),
    createdAt: int().notNull(),
    syncedToNotebook: int().default(0),
  },
  (table) => [index("findings_created_index").on(table.createdAt)],
);

export const stateTable = sqliteTable("state", {
  key: text().primaryKey(),
  value: text(),
});
