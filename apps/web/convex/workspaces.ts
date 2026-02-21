import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const get = query({
  args: {
    id: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const workspace = await ctx.db.get(args.id);
    if (!workspace) return null;
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return null;
    }

    return workspace;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const workspaces = await ctx.db.query("workspaces").collect();
    const userWorkspaces = workspaces.filter(
      (w) => w.createdBy === userId || w.collaborators.includes(userId),
    );

    // Fetch collaborator info for each workspace
    return Promise.all(
      userWorkspaces.map(async (workspace) => {
        const owner = await ctx.db.get(workspace.createdBy);
        const collaborators = await Promise.all(
          workspace.collaborators.map((id) => ctx.db.get(id)),
        );

        return {
          ...workspace,
          owner: owner
            ? {
                _id: owner._id,
                name: owner.name,
                email: owner.email,
                image: owner.image,
              }
            : null,
          collaboratorUsers: collaborators
            .filter((c) => c !== null)
            .map((c) => ({
              _id: c!._id,
              name: c!.name,
              email: c!.email,
              image: c!.image,
            })),
        };
      }),
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

    const now = Date.now();
    return await ctx.db.insert("workspaces", {
      title: args.title,
      hypothesis: args.hypothesis,
      createdBy: userId,
      collaborators: [],
      lastSavedAt: now,
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
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
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

export const addCollaborator = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.createdBy !== userId) {
      throw new Error("Only the owner can add collaborators");
    }

    // Find user by email
    const users = await ctx.db.query("users").collect();
    const userToAdd = users.find(
      (u) => u.email?.toLowerCase() === args.email.toLowerCase(),
    );
    if (!userToAdd) {
      throw new Error("User not found with that email");
    }

    // Don't add if already a collaborator or the owner
    if (userToAdd._id === workspace.createdBy) {
      throw new Error("Cannot add the owner as a collaborator");
    }
    if (workspace.collaborators.includes(userToAdd._id)) {
      throw new Error("User is already a collaborator");
    }

    await ctx.db.patch(args.workspaceId, {
      collaborators: [...workspace.collaborators, userToAdd._id],
    });

    return {
      userId: userToAdd._id,
      name: userToAdd.name,
      email: userToAdd.email,
    };
  },
});

export const removeCollaborator = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) throw new Error("Not authenticated");

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.createdBy !== currentUserId) {
      throw new Error("Only the owner can remove collaborators");
    }

    await ctx.db.patch(args.workspaceId, {
      collaborators: workspace.collaborators.filter((id) => id !== args.userId),
    });
  },
});

export const leaveWorkspace = mutation({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    if (workspace.createdBy === userId) {
      throw new Error("Owner cannot leave the workspace");
    }

    if (!workspace.collaborators.includes(userId)) {
      throw new Error("You are not a collaborator of this workspace");
    }

    await ctx.db.patch(args.workspaceId, {
      collaborators: workspace.collaborators.filter((id) => id !== userId),
    });
  },
});

export const setGpu = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    gpu: v.optional(
      v.union(
        v.literal("T4"),
        v.literal("L4"),
        v.literal("A10"),
        v.literal("A100"),
        v.literal("A100-40GB"),
        v.literal("A100-80GB"),
        v.literal("L40S"),
        v.literal("H100"),
        v.literal("H200"),
        v.literal("B200"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.workspaceId, { gpu: args.gpu });
  },
});

export const getCollaborators = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    if (
      workspace.createdBy !== userId &&
      !workspace.collaborators.includes(userId)
    ) {
      return null;
    }

    // Get owner info
    const owner = await ctx.db.get(workspace.createdBy);

    // Get all collaborator info
    const collaborators = await Promise.all(
      workspace.collaborators.map((id) => ctx.db.get(id)),
    );

    return {
      owner: owner
        ? {
            _id: owner._id,
            name: owner.name,
            email: owner.email,
            image: owner.image,
          }
        : null,
      collaborators: collaborators
        .filter((c) => c !== null)
        .map((c) => ({
          _id: c!._id,
          name: c!.name,
          email: c!.email,
          image: c!.image,
        })),
      isOwner: workspace.createdBy === userId,
      currentUserId: userId,
    };
  },
});
