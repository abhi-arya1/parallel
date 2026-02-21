import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  workspaces: defineTable({
    title: v.string(),
    hypothesis: v.string(),
    createdBy: v.id("users"),
    collaborators: v.array(v.id("users")),
  }),

  cells: defineTable({
    workspaceId: v.id("workspaces"),
    // Y.js cell ID (nanoid) - links Convex record to Y.Doc cell
    yjsCellId: v.string(),
    type: v.union(
      v.literal("hypothesis"),
      v.literal("finding"),
      v.literal("code"),
      v.literal("note"),
      v.literal("dead-end"),
      v.literal("ablation"),
      v.literal("synthesis"),
    ),
    // Content snapshot (for search/history - Y.js is source of truth for live editing)
    content: v.string(),
    authorType: v.union(v.literal("human"), v.literal("agent")),
    authorId: v.string(), // Can be Convex user ID or agent ID string
    agentRole: v.optional(
      v.union(
        v.literal("engineer"),
        v.literal("intern"),
        v.literal("researcher"),
        v.literal("reviewer"),
      ),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("promoted"),
      v.literal("pruned"),
      v.literal("pending"), // Agent is still writing
    ),
    // For code cells
    language: v.optional(v.string()),
    // Order in the document (synced from Y.js cellOrder array)
    orderIndex: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_yjs_cell_id", ["yjsCellId"])
    .index("by_workspace_order", ["workspaceId", "orderIndex"]),

  // Cell outputs (code execution results)
  cell_outputs: defineTable({
    cellId: v.id("cells"),
    yjsCellId: v.string(),
    type: v.union(
      v.literal("stdout"),
      v.literal("stderr"),
      v.literal("image"),
      v.literal("dataframe"),
      v.literal("error"),
    ),
    content: v.string(), // Text, base64 image, or JSON
    createdAt: v.number(),
  }).index("by_cell", ["cellId"]),

  // Experiment runs
  runs: defineTable({
    workspaceId: v.id("workspaces"),
    cellId: v.optional(v.id("cells")),
    yjsCellId: v.optional(v.string()),
    name: v.string(),
    agentRole: v.optional(
      v.union(
        v.literal("engineer"),
        v.literal("intern"),
        v.literal("researcher"),
        v.literal("reviewer"),
      ),
    ),
    config: v.any(), // Hyperparameters
    status: v.union(v.literal("live"), v.literal("done"), v.literal("failed")),
    // Metrics stored as array for simplicity
    metrics: v.array(
      v.object({
        step: v.number(),
        key: v.string(),
        value: v.number(),
        timestamp: v.number(),
      }),
    ),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  agents: defineTable({
    workspaceId: v.id("workspaces"),
    role: v.union(
      v.literal("engineer"),
      v.literal("intern"),
      v.literal("researcher"),
      v.literal("reviewer"),
    ),
    status: v.union(
      v.literal("spawning"),
      v.literal("thinking"),
      v.literal("working"),
      v.literal("working_hard"),
      v.literal("done"),
      v.literal("idle"),
    ),
    currentTask: v.optional(v.string()),
    modalJobId: v.optional(v.string()),
    findings: v.array(v.id("cells")),
  }).index("by_workspace", ["workspaceId"]),

  activity_stream: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    agentRole: v.optional(v.string()),
    message: v.string(),
    timestamp: v.number(),
  }).index("by_workspace_timestamp", ["workspaceId", "timestamp"]),

  threads: defineTable({
    cellId: v.id("cells"),
    yjsCellId: v.string(),
    workspaceId: v.id("workspaces"),
    authorType: v.union(v.literal("human"), v.literal("agent")),
    authorId: v.string(),
    authorName: v.string(),
    agentRole: v.optional(v.string()),
    content: v.string(),
    parentThreadId: v.optional(v.id("threads")),
    createdAt: v.number(),
  })
    .index("by_cell", ["cellId"])
    .index("by_yjs_cell", ["yjsCellId"])
    .index("by_parent", ["parentThreadId"]),
});
