"use client";

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import type { AwarenessUser } from "@/types/cells";

// Sync server URL - defaults to localhost in development
const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL || "http://localhost:8383";

/**
 * Create a Y.js provider connected to the sync server
 */
export function createProvider(
  workspaceId: string,
  ydoc: Y.Doc,
  user?: AwarenessUser,
): YPartyKitProvider {
  const provider = new YPartyKitProvider(
    SYNC_URL,
    `workspace-${workspaceId}`,
    ydoc,
    {
      connect: true,
      party: "document",
    },
  );

  // Set user awareness if provided
  if (user) {
    provider.awareness.setLocalStateField("user", user);
  }

  return provider;
}

/**
 * Get all users currently connected to the document
 */
export function getConnectedUsers(
  provider: YPartyKitProvider,
): AwarenessUser[] {
  const states = provider.awareness.getStates();
  const users: AwarenessUser[] = [];

  states.forEach((state) => {
    if (state.user) {
      users.push(state.user as AwarenessUser);
    }
  });

  return users;
}

/**
 * Subscribe to awareness changes
 */
export function subscribeToAwareness(
  provider: YPartyKitProvider,
  callback: (users: AwarenessUser[]) => void,
): () => void {
  const handler = () => {
    callback(getConnectedUsers(provider));
  };

  provider.awareness.on("change", handler);

  return () => {
    provider.awareness.off("change", handler);
  };
}

/**
 * Generate a random color for a user
 */
export function generateUserColor(): string {
  const colors = [
    "#F87171", // red
    "#FB923C", // orange
    "#FBBF24", // amber
    "#A3E635", // lime
    "#4ADE80", // green
    "#2DD4BF", // teal
    "#22D3EE", // cyan
    "#60A5FA", // blue
    "#A78BFA", // violet
    "#F472B6", // pink
  ];
  return colors[Math.floor(Math.random() * colors.length)] ?? "#60A5FA";
}

/**
 * Create awareness user from current user data
 */
export function createAwarenessUser(
  id: string,
  name: string,
  email?: string,
): AwarenessUser {
  return {
    id,
    name,
    email,
    color: generateUserColor(),
  };
}
