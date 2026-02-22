"use client";

import { useState, useEffect, useCallback } from "react";
import type YPartyKitProvider from "y-partykit/provider";

export interface CellPresenceUser {
  id: string;
  name: string;
  color: string;
  image?: string;
  clientId: number;
}

/**
 * Hook to track which users are focused on a specific cell
 */
export function useCellPresence(
  provider: YPartyKitProvider | null,
  cellId: string,
): CellPresenceUser[] {
  const [usersInCell, setUsersInCell] = useState<CellPresenceUser[]>([]);

  useEffect(() => {
    if (!provider?.awareness) return;

    const updatePresence = () => {
      const states = provider.awareness.getStates();
      const localClientId = provider.awareness.clientID;
      const users: CellPresenceUser[] = [];

      states.forEach((state: Record<string, unknown>, clientId: number) => {
        // Skip local user
        if (clientId === localClientId) return;

        const user = state.user as
          | {
              id?: string;
              name?: string;
              color?: string;
              image?: string;
            }
          | undefined;
        const focusedCell = state.focusedCell as string | undefined;

        // Check if this user is focused on our cell
        if (focusedCell === cellId && user?.name && user?.color) {
          users.push({
            id: user.id || String(clientId),
            name: user.name,
            color: user.color,
            image: user.image,
            clientId,
          });
        }
      });

      setUsersInCell(users);
    };

    provider.awareness.on("update", updatePresence);
    updatePresence();

    return () => {
      provider.awareness.off("update", updatePresence);
    };
  }, [provider, cellId]);

  return usersInCell;
}

/**
 * Hook to broadcast which cell the local user is focused on
 */
export function useBroadcastCellFocus(
  provider: YPartyKitProvider | null,
  cellId: string | null,
) {
  useEffect(() => {
    if (!provider?.awareness) return;

    provider.awareness.setLocalStateField("focusedCell", cellId);

    return () => {
      // Clear focus when unmounting
      provider.awareness.setLocalStateField("focusedCell", null);
    };
  }, [provider, cellId]);
}
