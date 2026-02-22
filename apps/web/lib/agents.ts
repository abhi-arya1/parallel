import type { Id } from "@/convex/_generated/dataModel";

const AGENTS_URL =
  process.env.NEXT_PUBLIC_AGENTS_URL || "http://localhost:8787";

export type AgentRole = "engineer" | "researcher" | "reviewer";

export interface SpawnAgentsResult {
  agentIds: Record<AgentRole, Id<"agents">>;
  workflowInstanceId: string;
}

export async function triggerHypothesisWorkflow(
  workspaceId: Id<"workspaces">,
  hypothesis: string,
  agentIds: Record<AgentRole, string>,
): Promise<{ instanceId: string }> {
  const response = await fetch(`${AGENTS_URL}/hypothesis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      hypothesis,
      agentIds,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to trigger workflow: ${error}`);
  }

  return response.json();
}

export async function triggerAgentContinue(
  workspaceId: Id<"workspaces">,
  agentId: string,
  role: AgentRole,
): Promise<{ instanceId: string }> {
  const response = await fetch(`${AGENTS_URL}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      agentId,
      role,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to continue agent: ${error}`);
  }

  return response.json();
}
