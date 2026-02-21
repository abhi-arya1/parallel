import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * List threads for a cell
 */
export const listByCell = query({
  args: {
    yjsCellId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get threads by Y.js cell ID
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_yjs_cell", (q) => q.eq("yjsCellId", args.yjsCellId))
      .collect();

    if (threads.length === 0) return [];

    // Verify access via workspace
    const firstThread = threads[0]!;
    const workspace = await ctx.db.get(firstThread.workspaceId);
    if (!workspace) return [];
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return [];
    }

    // Sort by createdAt and organize by parent
    return threads.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/**
 * Create a new thread reply
 */
export const create = mutation({
  args: {
    yjsCellId: v.string(),
    workspaceId: v.id("workspaces"),
    content: v.string(),
    parentThreadId: v.optional(v.id("threads")),
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

    // Get the cell
    const cell = await ctx.db
      .query("cells")
      .withIndex("by_yjs_cell_id", (q) => q.eq("yjsCellId", args.yjsCellId))
      .first();

    if (!cell) throw new Error("Cell not found");

    // Get user info
    const user = await ctx.db.get(userId);
    const authorName = user?.name ?? "Anonymous";

    // If there's a parent thread, verify it exists and isn't already a reply
    if (args.parentThreadId) {
      const parentThread = await ctx.db.get(args.parentThreadId);
      if (!parentThread) throw new Error("Parent thread not found");
      // Only allow 2 levels deep
      if (parentThread.parentThreadId) {
        throw new Error("Cannot reply to a reply (max 2 levels)");
      }
    }

    return await ctx.db.insert("threads", {
      cellId: cell._id,
      yjsCellId: args.yjsCellId,
      workspaceId: args.workspaceId,
      authorType: "human",
      authorId: userId,
      authorName,
      content: args.content,
      parentThreadId: args.parentThreadId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete a thread
 */
export const remove = mutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");

    // Only the author can delete their own thread
    if (thread.authorId !== userId) {
      throw new Error("Not authorized to delete this thread");
    }

    // Delete any replies to this thread
    const replies = await ctx.db
      .query("threads")
      .withIndex("by_parent", (q) => q.eq("parentThreadId", args.threadId))
      .collect();

    for (const reply of replies) {
      await ctx.db.delete(reply._id);
    }

    await ctx.db.delete(args.threadId);
  },
});

/**
 * Get thread count for a cell (for UI badges)
 */
export const getCount = query({
  args: {
    yjsCellId: v.string(),
  },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_yjs_cell", (q) => q.eq("yjsCellId", args.yjsCellId))
      .collect();

    return threads.length;
  },
});
