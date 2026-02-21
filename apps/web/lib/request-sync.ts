const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL || "http://localhost:8383";

/**
 * Request the sync server to push Y.js state to Convex.
 * Fire-and-forget — callers don't need to await.
 */
export function requestSync(workspaceId: string): void {
  const url = `${SYNC_URL}/parties/document/workspace-${workspaceId}`;

  fetch(url, { method: "POST" }).catch((err) => {
    console.error("[requestSync] Failed to trigger sync:", err);
  });
}
