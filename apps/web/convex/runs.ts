import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Agent role validator
const agentRoleValidator = v.union(
  v.literal("engineer"),
  v.literal("researcher"),
  v.literal("reviewer"),
);

/**
 * List runs for a workspace
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Verify access to workspace
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return [];
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return [];
    }

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Sort: live runs first, then by createdAt descending
    return runs.sort((a, b) => {
      if (a.status === "live" && b.status !== "live") return -1;
      if (a.status !== "live" && b.status === "live") return 1;
      return b.createdAt - a.createdAt;
    });
  },
});

/**
 * Get live runs only
 */
export const listLive = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Verify access to workspace
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return [];
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return [];
    }

    return await ctx.db
      .query("runs")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "live"),
      )
      .collect();
  },
});

/**
 * Create a new run
 */
export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    yjsCellId: v.optional(v.string()),
    agentRole: v.optional(agentRoleValidator),
    config: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify access to workspace
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    // Get cell ID if yjsCellId provided
    let cellId = undefined;
    const yjsCellId = args.yjsCellId;
    if (yjsCellId) {
      const cell = await ctx.db
        .query("cells")
        .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", yjsCellId))
        .first();
      if (cell) {
        cellId = cell._id;
      }
    }

    return await ctx.db.insert("runs", {
      workspaceId: args.workspaceId,
      cellId,
      yjsCellId: args.yjsCellId,
      name: args.name,
      agentRole: args.agentRole,
      config: args.config,
      status: "live",
      metrics: [],
      createdAt: Date.now(),
    });
  },
});

/**
 * Add a metric to a run
 */
export const addMetric = mutation({
  args: {
    runId: v.id("runs"),
    step: v.number(),
    key: v.string(),
    value: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    // Verify access to workspace
    const workspace = await ctx.db.get(run.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    const existingMetrics = run.metrics ?? [];
    await ctx.db.patch(args.runId, {
      metrics: [
        ...existingMetrics,
        {
          step: args.step,
          key: args.key,
          value: args.value,
          timestamp: Date.now(),
        },
      ],
    });
  },
});

/**
 * Update run status
 */
export const updateStatus = mutation({
  args: {
    runId: v.id("runs"),
    status: v.union(v.literal("live"), v.literal("done"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    // Verify access to workspace
    const workspace = await ctx.db.get(run.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    const update: { status: typeof args.status; completedAt?: number } = {
      status: args.status,
    };

    if (args.status === "done" || args.status === "failed") {
      update.completedAt = Date.now();
    }

    await ctx.db.patch(args.runId, update);
  },
});

/**
 * Delete a run
 */
export const remove = mutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    // Verify access to workspace
    const workspace = await ctx.db.get(run.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.runId);
  },
});
