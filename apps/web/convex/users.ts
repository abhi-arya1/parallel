import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const getByIds = query({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));

    return users
      .filter((u) => u !== null)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        image: u.image,
      }));
  },
});
