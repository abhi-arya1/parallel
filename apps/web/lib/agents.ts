export type AgentRole = "engineer" | "researcher" | "reviewer";

export const ALL_ROLES: AgentRole[] = ["engineer", "researcher", "reviewer"];

export const AGENTS_URL =
  process.env.NEXT_PUBLIC_AGENTS_URL || "http://localhost:8787";

export function getAgentWsUrl(workspaceId: string): string {
  const base = AGENTS_URL.replace("http://", "ws://").replace(
    "https://",
    "wss://",
  );
  return `${base}/agents/workspace-agent/${workspaceId}`;
}
