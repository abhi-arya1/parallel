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
  // y-monaco expects name and color at root level for cursor rendering
  if (user) {
    provider.awareness.setLocalStateField("user", user);
    provider.awareness.setLocalStateField("name", user.name);
    provider.awareness.setLocalStateField("color", user.color);
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
 * Generate a stable color based on a string (name)
 */
export function getStableColor(name: string): string {
  const colors = [
    "#E57373",
    "#F06292",
    "#BA68C8",
    "#9575CD",
    "#7986CB",
    "#64B5F6",
    "#4FC3F7",
    "#4DD0E1",
    "#4DB6AC",
    "#81C784",
    "#AED581",
    "#DCE775",
    "#FFD54F",
    "#FFB74D",
    "#FF8A65",
    "#A1887F",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length]!;
}

/**
 * Create awareness user from current user data
 */
export function createAwarenessUser(
  id: string,
  name: string,
  email?: string,
  image?: string,
): AwarenessUser {
  return {
    id,
    name,
    email,
    image,
    color: getStableColor(name),
  };
}
