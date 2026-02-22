import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Cell type validator
const cellTypeValidator = v.union(v.literal("markdown"), v.literal("code"));

// Cell status validator
const cellStatusValidator = v.union(
  v.literal("active"),
  v.literal("promoted"),
  v.literal("pruned"),
  v.literal("pending"),
);

// Agent role validator
const agentRoleValidator = v.union(
  v.literal("engineer"),
  v.literal("researcher"),
  v.literal("reviewer"),
);

/**
 * List all cells for a workspace
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

    const cells = await ctx.db
      .query("cells")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Sort by orderIndex if available, otherwise by createdAt
    return cells.sort((a, b) => {
      if (a.orderIndex !== undefined && b.orderIndex !== undefined) {
        return a.orderIndex - b.orderIndex;
      }
      return a.createdAt - b.createdAt;
    });
  },
});

/**
 * Get a single cell by its Y.js cell ID
 */
export const getByYjsId = query({
  args: {
    yjsCellId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) return null;

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) return null;
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return null;
    }

    return cell;
  },
});

/**
 * Create a new cell (usually called when syncing from Y.js)
 */
export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    yjsCellId: v.string(),
    type: cellTypeValidator,
    content: v.optional(v.string()),
    authorType: v.union(v.literal("human"), v.literal("agent")),
    authorId: v.string(),
    agentRole: v.optional(agentRoleValidator),
    status: v.optional(cellStatusValidator),
    language: v.optional(v.string()),
    orderIndex: v.optional(v.number()),
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

    const now = Date.now();
    return await ctx.db.insert("cells", {
      workspaceId: args.workspaceId,
      yjsCellId: args.yjsCellId,
      type: args.type,
      content: args.content ?? "",
      authorType: args.authorType,
      authorId: args.authorId,
      agentRole: args.agentRole,
      status: args.status ?? "active",
      language: args.language,
      orderIndex: args.orderIndex,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update a cell's content (sync from Y.js)
 */
export const updateContent = mutation({
  args: {
    yjsCellId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(cell._id, {
      content: args.content,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update a cell's status
 */
export const updateStatus = mutation({
  args: {
    yjsCellId: v.string(),
    status: cellStatusValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(cell._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update a cell's type
 */
export const updateType = mutation({
  args: {
    yjsCellId: v.string(),
    type: cellTypeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(cell._id, {
      type: args.type,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Delete a cell
 */
export const remove = mutation({
  args: {
    yjsCellId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    // Delete associated outputs
    const outputs = await ctx.db
      .query("cell_outputs")
      .withIndex("by_cell", (q) => q.eq("cellId", cell._id))
      .collect();

    for (const output of outputs) {
      await ctx.db.delete(output._id);
    }

    // Delete associated threads
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_cell", (q) => q.eq("cellId", cell._id))
      .collect();

    for (const thread of threads) {
      await ctx.db.delete(thread._id);
    }

    await ctx.db.delete(cell._id);
  },
});

/**
 * Get outputs for a cell (includes lastRunTimeMs)
 */
export const getOutputs = query({
  args: {
    yjsCellId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) return null;

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) return null;
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return null;
    }

    const outputs = await ctx.db
      .query("cell_outputs")
      .withIndex("by_cell", (q) => q.eq("cellId", cell._id))
      .collect();

    return {
      outputs,
      lastRunTimeMs: cell.lastRunTimeMs,
    };
  },
});

/**
 * Update the last run time for a cell
 */
export const updateRunTime = mutation({
  args: {
    yjsCellId: v.string(),
    runTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) return;

    await ctx.db.patch(cell._id, {
      lastRunTimeMs: args.runTimeMs,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Add output to a cell (from code execution)
 */
export const addOutput = mutation({
  args: {
    yjsCellId: v.string(),
    type: v.union(
      v.literal("stdout"),
      v.literal("stderr"),
      v.literal("image"),
      v.literal("dataframe"),
      v.literal("error"),
    ),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    return await ctx.db.insert("cell_outputs", {
      cellId: cell._id,
      yjsCellId: args.yjsCellId,
      type: args.type,
      content: args.content,
      createdAt: Date.now(),
    });
  },
});

/**
 * Clear outputs for a cell
 */
export const clearOutputs = mutation({
  args: {
    yjsCellId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Verify access
    const workspace = await ctx.db.get(cell.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    const outputs = await ctx.db
      .query("cell_outputs")
      .withIndex("by_cell", (q) => q.eq("cellId", cell._id))
      .collect();

    for (const output of outputs) {
      await ctx.db.delete(output._id);
    }
  },
});

/**
 * Clear all outputs for all cells in a workspace
 */
export const clearAllOutputs = mutation({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify access
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    // Get all cells for this workspace
    const cells = await ctx.db
      .query("cells")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Delete all outputs for each cell
    for (const cell of cells) {
      const outputs = await ctx.db
        .query("cell_outputs")
        .withIndex("by_cell", (q) => q.eq("cellId", cell._id))
        .collect();

      for (const output of outputs) {
        await ctx.db.delete(output._id);
      }
    }
  },
});
