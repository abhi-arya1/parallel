import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const workspaces = await ctx.db.query("workspaces").collect();
    return workspaces.filter(
      (w) =>
        w.createdBy === userId || w.collaborators.includes(userId),
    );
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    hypothesis: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("workspaces", {
      title: args.title,
      hypothesis: args.hypothesis,
      createdBy: userId,
      collaborators: [],
    });
  },
});

export const rename = mutation({
  args: {
    id: v.id("workspaces"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.createdBy !== userId && !workspace.collaborators.includes(userId)) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const remove = mutation({
  args: {
    id: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.createdBy !== userId) {
      throw new Error("Only the creator can delete a workspace");
    }

    await ctx.db.delete(args.id);
  },
});
