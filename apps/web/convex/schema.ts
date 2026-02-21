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
    type: v.union(
      v.literal("hypothesis"),
      v.literal("finding"),
      v.literal("code"),
      v.literal("note"),
      v.literal("dead-end"),
      v.literal("ablation"),
      v.literal("synthesis"),
    ),
    content: v.string(),
    authorType: v.union(v.literal("human"), v.literal("agent")),
    authorId: v.union(v.id("users"), v.id("agents")),
    agentRole: v.optional(v.string()),
    parentCellId: v.optional(v.id("cells")),
    status: v.union(
      v.literal("active"),
      v.literal("promoted"),
      v.literal("pruned"),
    ),
    version: v.number(),
    previousCellId: v.optional(v.id("cells")),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_parent", ["parentCellId"]),

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
    agentId: v.id("agents"),
    message: v.string(),
    timestamp: v.number(),
  }).index("by_workspace_timestamp", ["workspaceId", "timestamp"]),

  threads: defineTable({
    cellId: v.id("cells"),
    workspaceId: v.id("workspaces"),
    authorType: v.union(v.literal("human"), v.literal("agent")),
    authorId: v.union(v.id("users"), v.id("agents")),
    content: v.string(),
    parentThreadId: v.optional(v.id("threads")),
    createdAt: v.number(),
  })
    .index("by_cell", ["cellId"])
    .index("by_parent", ["parentThreadId"]),
});
