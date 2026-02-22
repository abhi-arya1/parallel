export class AgentConvexClient {
  private convexUrl: string;
  private syncKey: string;
  private syncServerUrl?: string;

  constructor(convexUrl: string, syncKey: string, syncServerUrl?: string) {
    this.convexUrl = convexUrl;
    this.syncKey = syncKey;
    this.syncServerUrl = syncServerUrl;
  }

  private async mutation(name: string, args: Record<string, unknown>) {
    const response = await fetch(`${this.convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: name,
        args: { ...args, syncKey: this.syncKey },
      }),
    });

    if (!response.ok) {
      throw new Error(`Convex mutation failed: ${response.statusText}`);
    }

    return response.json();
  }

  private async query(name: string, args: Record<string, unknown>) {
    const response = await fetch(`${this.convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: name,
        args: { ...args, syncKey: this.syncKey },
      }),
    });

    if (!response.ok) {
      throw new Error(`Convex query failed: ${response.statusText}`);
    }

    return response.json();
  }

  async postActivity(agentId: string, contentType: string, content: unknown) {
    return this.mutation("agents:postActivity", {
      agentId,
      contentType,
      content,
    });
  }

  async updateStatus(
    agentId: string,
    status: string,
    currentTask?: string,
    error?: string,
  ) {
    return this.mutation("agents:updateStatus", {
      agentId,
      status,
      currentTask,
      error,
    });
  }

  async createFinding(
    agentId: string,
    content: string,
    cellType?: "markdown" | "code",
  ) {
    return this.mutation("agents:createFinding", {
      agentId,
      content,
      cellType,
    });
  }

  async addAssistantMessage(agentId: string, content: string) {
    return this.mutation("agents:addAssistantMessage", {
      agentId,
      content,
    });
  }

  async requestApproval(
    agentId: string,
    action: "execute_code" | "publish_finding",
    code?: string,
  ) {
    return this.mutation("agents:requestApproval", {
      agentId,
      action,
      code,
    });
  }

  async checkApprovalStatus(agentId: string) {
    return this.query("agents:checkApprovalStatus", { agentId });
  }

  async getNewMessages(agentId: string, afterTimestamp: number) {
    return this.query("agents:getNewMessages", { agentId, afterTimestamp });
  }

  async getAgentFindings(workspaceId: string, excludeAgentId?: string) {
    return this.query("agents:getAgentFindings", {
      workspaceId,
      excludeAgentId,
    });
  }

  async streamActivity(
    agentId: string,
    streamId: string,
    contentType: string,
    content: unknown,
    isPartial: boolean,
  ) {
    return this.mutation("agents:streamActivity", {
      agentId,
      streamId,
      contentType,
      content,
      isPartial,
    });
  }

  async getNotebookMarkdown(workspaceId: string): Promise<string> {
    if (!this.syncServerUrl) {
      throw new Error("Sync server URL not configured");
    }

    const response = await fetch(
      `${this.syncServerUrl}/parties/document/workspace-${workspaceId}/markdown`,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch notebook markdown: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { ok: boolean; markdown: string };
    return data.markdown;
  }
}
