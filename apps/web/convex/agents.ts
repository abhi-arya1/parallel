import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const agentRoleValidator = v.union(
  v.literal("engineer"),
  v.literal("researcher"),
  v.literal("reviewer"),
);

const agentStatusValidator = v.union(
  v.literal("spawning"),
  v.literal("thinking"),
  v.literal("working"),
  v.literal("working_hard"),
  v.literal("awaiting_approval"),
  v.literal("done"),
  v.literal("idle"),
  v.literal("error"),
);

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const get = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.agentId);
  },
});

export const getActivityStream = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const activities = await ctx.db
      .query("activity_stream")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("asc")
      .take(args.limit ?? 100);
    return activities;
  },
});

export const getMessages = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agent_messages")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("asc")
      .collect();
  },
});

export const spawnAgents = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    roles: v.array(agentRoleValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const agentIds: Record<string, string> = {};

    for (const role of args.roles) {
      const existing = await ctx.db
        .query("agents")
        .withIndex("by_workspace_role", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("role", role),
        )
        .first();

      if (existing) {
        const activities = await ctx.db
          .query("activity_stream")
          .withIndex("by_agent", (q) => q.eq("agentId", existing._id))
          .collect();
        for (const activity of activities) {
          await ctx.db.delete(activity._id);
        }

        const messages = await ctx.db
          .query("agent_messages")
          .withIndex("by_agent", (q) => q.eq("agentId", existing._id))
          .collect();
        for (const message of messages) {
          await ctx.db.delete(message._id);
        }

        await ctx.db.patch(existing._id, {
          status: "spawning",
          currentTask: undefined,
          error: undefined,
          startedAt: now,
          completedAt: undefined,
          pendingAction: undefined,
          pendingCode: undefined,
        });
        agentIds[role] = existing._id;
      } else {
        const id = await ctx.db.insert("agents", {
          workspaceId: args.workspaceId,
          role,
          status: "spawning",
          findings: [],
          startedAt: now,
        });
        agentIds[role] = id;
      }
    }

    return agentIds;
  },
});

export const stopAllAgents = mutation({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const now = Date.now();
    for (const agent of agents) {
      if (
        ["spawning", "thinking", "working", "awaiting_approval"].includes(
          agent.status,
        )
      ) {
        await ctx.db.patch(agent._id, {
          status: "idle",
          currentTask: undefined,
          pendingAction: undefined,
          pendingCode: undefined,
          completedAt: now,
          error: "Stopped by user",
        });

        await ctx.db.insert("activity_stream", {
          workspaceId: args.workspaceId,
          agentId: agent._id,
          agentRole: agent.role,
          contentType: "stopped",
          content: { message: "Stopped by user" },
          timestamp: now,
        });
      }
    }

    return { stopped: true };
  },
});

export const postActivity = mutation({
  args: {
    syncKey: v.string(),
    agentId: v.id("agents"),
    contentType: v.string(),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    await ctx.db.insert("activity_stream", {
      workspaceId: agent.workspaceId,
      agentId: args.agentId,
      agentRole: agent.role,
      contentType: args.contentType,
      content: args.content,
      timestamp: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    syncKey: v.string(),
    agentId: v.id("agents"),
    status: agentStatusValidator,
    currentTask: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const updates: Record<string, any> = { status: args.status };
    if (args.currentTask !== undefined) updates.currentTask = args.currentTask;
    if (args.error !== undefined) updates.error = args.error;
    if (args.status === "done" || args.status === "error") {
      updates.completedAt = Date.now();
    }

    await ctx.db.patch(args.agentId, updates);
  },
});

export const createFinding = mutation({
  args: {
    syncKey: v.string(),
    agentId: v.id("agents"),
    content: v.string(),
    cellType: v.optional(v.union(v.literal("markdown"), v.literal("code"))),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    const now = Date.now();
    const yjsCellId = `agent-${args.agentId}-${now}`;

    const cellId = await ctx.db.insert("cells", {
      workspaceId: agent.workspaceId,
      yjsCellId,
      type: args.cellType ?? "markdown",
      content: args.content,
      authorType: "agent",
      authorId: args.agentId,
      agentRole: agent.role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.agentId, {
      findings: [...agent.findings, cellId],
    });

    return { cellId, yjsCellId };
  },
});

export const sendMessage = mutation({
  args: {
    agentId: v.id("agents"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    await ctx.db.insert("agent_messages", {
      workspaceId: agent.workspaceId,
      agentId: args.agentId,
      role: "user",
      content: args.content,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

export const addAssistantMessage = mutation({
  args: {
    syncKey: v.string(),
    agentId: v.id("agents"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    await ctx.db.insert("agent_messages", {
      workspaceId: agent.workspaceId,
      agentId: args.agentId,
      role: "assistant",
      content: args.content,
      timestamp: Date.now(),
    });
  },
});

export const getAgentFindings = query({
  args: {
    workspaceId: v.id("workspaces"),
    excludeAgentId: v.optional(v.id("agents")),
  },
  handler: async (ctx, args) => {
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const findings: Array<{
      agentId: string;
      role: string;
      cellId: string;
      content: string;
    }> = [];

    for (const agent of agents) {
      if (args.excludeAgentId && agent._id === args.excludeAgentId) continue;

      for (const cellId of agent.findings) {
        const cell = await ctx.db.get(cellId);
        if (cell) {
          findings.push({
            agentId: agent._id,
            role: agent.role,
            cellId: cell._id,
            content: cell.content,
          });
        }
      }
    }

    return findings;
  },
});

export const requestApproval = mutation({
  args: {
    syncKey: v.string(),
    agentId: v.id("agents"),
    action: v.union(v.literal("execute_code"), v.literal("publish_finding")),
    code: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    await ctx.db.patch(args.agentId, {
      status: "awaiting_approval",
      pendingAction: args.action,
      pendingCode: args.code,
    });
  },
});

export const approveAction = mutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");
    if (agent.status !== "awaiting_approval") {
      throw new Error("Agent is not awaiting approval");
    }

    await ctx.db.patch(args.agentId, {
      status: "working",
      pendingAction: undefined,
    });

    await ctx.db.insert("activity_stream", {
      workspaceId: agent.workspaceId,
      agentId: args.agentId,
      agentRole: agent.role,
      contentType: "approval",
      content: { approved: true },
      timestamp: Date.now(),
    });

    return { approved: true, pendingCode: agent.pendingCode };
  },
});

export const rejectAction = mutation({
  args: {
    agentId: v.id("agents"),
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");
    if (agent.status !== "awaiting_approval") {
      throw new Error("Agent is not awaiting approval");
    }

    await ctx.db.patch(args.agentId, {
      status: "thinking",
      pendingAction: undefined,
      pendingCode: undefined,
    });

    await ctx.db.insert("activity_stream", {
      workspaceId: agent.workspaceId,
      agentId: args.agentId,
      agentRole: agent.role,
      contentType: "approval",
      content: { approved: false, feedback: args.feedback },
      timestamp: Date.now(),
    });

    if (args.feedback) {
      await ctx.db.insert("agent_messages", {
        workspaceId: agent.workspaceId,
        agentId: args.agentId,
        role: "user",
        content: args.feedback,
        timestamp: Date.now(),
      });
    }

    return { approved: false };
  },
});

export const setAutoApprove = mutation({
  args: {
    agentId: v.id("agents"),
    autoApprove: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      autoApprove: args.autoApprove,
    });
  },
});

export const streamActivity = mutation({
  args: {
    syncKey: v.string(),
    agentId: v.id("agents"),
    streamId: v.string(),
    contentType: v.string(),
    content: v.any(),
    isPartial: v.boolean(),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey || args.syncKey !== expectedKey) {
      throw new Error("Invalid sync key");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    const existing = await ctx.db
      .query("activity_stream")
      .withIndex("by_stream", (q) => q.eq("streamId", args.streamId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        isPartial: args.isPartial,
        timestamp: Date.now(),
      });
    } else {
      await ctx.db.insert("activity_stream", {
        workspaceId: agent.workspaceId,
        agentId: args.agentId,
        agentRole: agent.role,
        contentType: args.contentType,
        content: args.content,
        timestamp: Date.now(),
        streamId: args.streamId,
        isPartial: args.isPartial,
      });
    }
  },
});

export const checkApprovalStatus = query({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;

    return {
      status: agent.status,
      pendingAction: agent.pendingAction,
      autoApprove: agent.autoApprove,
    };
  },
});

export const getNewMessages = query({
  args: {
    agentId: v.id("agents"),
    afterTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agent_messages")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) => q.gt(q.field("timestamp"), args.afterTimestamp))
      .order("asc")
      .collect();
  },
});

export const continueAgent = mutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    if (!["done", "idle", "error"].includes(agent.status)) {
      return { needsContinue: false, status: agent.status };
    }

    await ctx.db.patch(args.agentId, {
      status: "thinking",
      completedAt: undefined,
      error: undefined,
    });

    return {
      needsContinue: true,
      workspaceId: agent.workspaceId,
      role: agent.role,
    };
  },
});
