import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Validators matching the schema
const cellTypeValidator = v.union(v.literal("markdown"), v.literal("code"));

const cellStatusValidator = v.union(
  v.literal("active"),
  v.literal("promoted"),
  v.literal("pruned"),
  v.literal("pending"),
);

const agentRoleValidator = v.union(
  v.literal("engineer"),
  v.literal("researcher"),
  v.literal("reviewer"),
);

/**
 * Sync cells from Y.js document to Convex.
 * Called by the sync server on save (debounced).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const syncCells = mutation({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
    cells: v.array(
      v.object({
        yjsCellId: v.string(),
        type: cellTypeValidator,
        content: v.string(),
        authorType: v.union(v.literal("human"), v.literal("agent")),
        authorId: v.string(),
        agentRole: v.optional(agentRoleValidator),
        status: cellStatusValidator,
        language: v.optional(v.string()),
        orderIndex: v.number(),
        createdAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Validate sync key
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const now = Date.now();

    // Get all existing cells for this workspace
    const existingCells = await ctx.db
      .query("cells")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const existingByYjsId = new Map(existingCells.map((c) => [c.yjsCellId, c]));

    // Track which yjsCellIds are in the Y.js doc
    const yjsCellIds = new Set(args.cells.map((c) => c.yjsCellId));

    // Upsert cells
    for (const cell of args.cells) {
      const existing = existingByYjsId.get(cell.yjsCellId);

      if (existing) {
        // Only patch if something actually changed — avoids triggering reactive queries
        const changed =
          existing.type !== cell.type ||
          existing.content !== cell.content ||
          existing.status !== cell.status ||
          existing.language !== cell.language ||
          existing.agentRole !== cell.agentRole ||
          existing.orderIndex !== cell.orderIndex;

        if (changed) {
          await ctx.db.patch(existing._id, {
            type: cell.type,
            content: cell.content,
            status: cell.status,
            language: cell.language,
            agentRole: cell.agentRole,
            orderIndex: cell.orderIndex,
            updatedAt: now,
          });
        }
      } else {
        // Create new cell
        await ctx.db.insert("cells", {
          workspaceId: args.workspaceId,
          yjsCellId: cell.yjsCellId,
          type: cell.type,
          content: cell.content,
          authorType: cell.authorType,
          authorId: cell.authorId,
          agentRole: cell.agentRole,
          status: cell.status,
          language: cell.language,
          orderIndex: cell.orderIndex,
          createdAt: cell.createdAt,
          updatedAt: now,
        });
      }
    }

    // Delete cells no longer in Y.js (cascade to outputs and threads)
    for (const existing of existingCells) {
      if (!yjsCellIds.has(existing.yjsCellId)) {
        // Delete associated outputs
        const outputs = await ctx.db
          .query("cell_outputs")
          .withIndex("by_cell", (q) => q.eq("cellId", existing._id))
          .collect();
        for (const output of outputs) {
          await ctx.db.delete(output._id);
        }

        // Delete associated threads
        const threads = await ctx.db
          .query("threads")
          .withIndex("by_cell", (q) => q.eq("cellId", existing._id))
          .collect();
        for (const thread of threads) {
          await ctx.db.delete(thread._id);
        }

        await ctx.db.delete(existing._id);
      }
    }

    // Update workspace lastSavedAt
    await ctx.db.patch(args.workspaceId, { lastSavedAt: now });
  },
});

/**
 * Get workspace GPU setting (used by sandbox server).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const getWorkspaceGpu = query({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    return workspace.gpu ?? null;
  },
});

/**
 * Get the kernel sandbox ID for a workspace (used by sandbox server).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const getWorkspaceKernel = query({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    return workspace.kernelSandboxId ?? null;
  },
});

/**
 * Set the kernel sandbox ID for a workspace (used by sandbox server).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const setWorkspaceKernel = mutation({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
    sandboxId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    await ctx.db.patch(args.workspaceId, {
      kernelSandboxId: args.sandboxId ?? undefined,
    });
  },
});

/**
 * Get all cells for a workspace (used by sync server on load).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const getCells = query({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    // Validate sync key
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const cells = await ctx.db
      .query("cells")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return cells.sort((a, b) => {
      if (a.orderIndex !== undefined && b.orderIndex !== undefined) {
        return a.orderIndex - b.orderIndex;
      }
      return a.createdAt - b.createdAt;
    });
  },
});

// --- Y.js snapshot file storage ---

/**
 * Generate an upload URL for the Y.js document snapshot.
 */
export const generateSnapshotUploadUrl = mutation({
  args: {
    syncKey: v.string(),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Save a snapshot storageId to the workspace and delete the previous snapshot.
 */
export const saveSnapshot = mutation({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    // Delete the old snapshot file if it exists
    if (workspace.yjsSnapshotId) {
      await ctx.storage.delete(workspace.yjsSnapshotId);
    }

    await ctx.db.patch(args.workspaceId, {
      yjsSnapshotId: args.storageId,
    });
  },
});

/**
 * Get the download URL for the Y.js snapshot (if one exists).
 */
export const getSnapshot = query({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace?.yjsSnapshotId) return null;

    const url = await ctx.storage.getUrl(workspace.yjsSnapshotId);
    return url;
  },
});

// --- Cell Output Storage (for sandbox execution results) ---

const outputTypeValidator = v.union(
  v.literal("stdout"),
  v.literal("stderr"),
  v.literal("image"),
  v.literal("dataframe"),
  v.literal("error"),
  v.literal("result"),
);

/**
 * Save cell execution output from the sandbox server.
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const saveCellOutput = mutation({
  args: {
    syncKey: v.string(),
    cellId: v.id("cells"),
    yjsCellId: v.string(),
    type: outputTypeValidator,
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    // Verify cell exists
    const cell = await ctx.db.get(args.cellId);
    if (!cell) {
      throw new Error("Cell not found");
    }

    // Insert the output
    await ctx.db.insert("cell_outputs", {
      cellId: args.cellId,
      yjsCellId: args.yjsCellId,
      type: args.type,
      content: args.content,
      createdAt: Date.now(),
    });
  },
});

/**
 * Clear all outputs for a cell (called before re-execution).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const clearCellOutputs = mutation({
  args: {
    syncKey: v.string(),
    cellId: v.id("cells"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const outputs = await ctx.db
      .query("cell_outputs")
      .withIndex("by_cell", (q) => q.eq("cellId", args.cellId))
      .collect();

    for (const output of outputs) {
      await ctx.db.delete(output._id);
    }
  },
});

/**
 * Get all outputs for a cell.
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const getCellOutputs = query({
  args: {
    syncKey: v.string(),
    cellId: v.id("cells"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    return await ctx.db
      .query("cell_outputs")
      .withIndex("by_cell", (q) => q.eq("cellId", args.cellId))
      .collect();
  },
});

/**
 * Get all threads for a workspace (used by sync server for markdown export).
 * Validates via INTERNAL_API_KEY — no user auth required.
 */
export const getThreads = query({
  args: {
    syncKey: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const cells = await ctx.db
      .query("cells")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const cellIds = new Set(cells.map((c) => c._id));
    const allThreads = [];

    for (const cell of cells) {
      const threads = await ctx.db
        .query("threads")
        .withIndex("by_yjs_cell", (q) => q.eq("yjsCellId", cell.yjsCellId))
        .collect();
      allThreads.push(...threads);
    }

    return allThreads.sort((a, b) => a.createdAt - b.createdAt);
  },
});
