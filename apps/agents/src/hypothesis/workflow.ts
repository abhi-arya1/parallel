import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import {
  ENGINEER_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
} from "./prompts";

export type HypothesisWorkflowParams = {
  workspaceId: string;
  hypothesis: string;
  agentIds: {
    engineer: string;
    researcher: string;
    reviewer: string;
  };
  convexUrl: string;
  syncKey: string;
  syncServerUrl?: string;
  sandboxUrl?: string;
  parallelApiKey?: string;
};

type AgentRole = "engineer" | "researcher" | "reviewer";

interface AgentContext {
  convexUrl: string;
  syncKey: string;
  syncServerUrl?: string;
  sandboxUrl?: string;
  workspaceId: string;
  agentId: string;
  hypothesis: string;
  notebookContext?: string;
}

const ROLE_CONFIG = {
  engineer: {
    systemPrompt: ENGINEER_SYSTEM_PROMPT,
    timeout: "60 seconds" as const,
    maxTokens: 1500,
    activityMessages: {
      start: "Designing experiment...",
      execute: "Running sweep...",
      analyze: "Analyzing results...",
    },
  },
  researcher: {
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    timeout: "30 seconds" as const,
    maxTokens: 800,
    activityMessages: {
      start: "Searching for papers...",
      analyze: "Summarizing relevance...",
    },
  },
  reviewer: {
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    timeout: "30 seconds" as const,
    maxTokens: 800,
    activityMessages: {
      start: "Building counterargument...",
      analyze: "Flagging underspecified terms...",
    },
  },
} as const;

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const details: string[] = [error.message];
    if (error.cause) {
      details.push(`Cause: ${formatError(error.cause)}`);
    }
    if (error.stack) {
      details.push(`Stack: ${error.stack.split("\n").slice(0, 3).join("\n")}`);
    }
    return details.join(" | ");
  }
  return String(error);
}

class ConvexClient {
  constructor(
    private convexUrl: string,
    private syncKey: string,
  ) {}

  private async mutation(name: string, args: Record<string, unknown>) {
    console.log(
      `[ConvexClient] mutation ${name}`,
      JSON.stringify(args).slice(0, 200),
    );
    const response = await fetch(`${this.convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: name,
        args: { ...args, syncKey: this.syncKey },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[ConvexClient] mutation ${name} failed:`,
        response.status,
        text,
      );
      throw new Error(`Convex mutation failed: ${response.status} ${text}`);
    }
    return response.json();
  }

  private async query(name: string, args: Record<string, unknown>) {
    const response = await fetch(`${this.convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: name,
        args,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[ConvexClient] query ${name} failed:`,
        response.status,
        text,
      );
      throw new Error(`Convex query failed: ${response.status} ${text}`);
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
    cellType: "markdown" | "code" = "markdown",
  ) {
    return this.mutation("agents:createFinding", {
      agentId,
      content,
      cellType,
    });
  }

  async requestApproval(agentId: string, action: string, code?: string) {
    return this.mutation("agents:requestApproval", { agentId, action, code });
  }

  async checkApprovalStatus(agentId: string): Promise<{
    status: string;
    pendingAction?: string;
    autoApprove?: boolean;
  }> {
    return this.query("agents:checkApprovalStatus", { agentId }) as Promise<{
      status: string;
      pendingAction?: string;
      autoApprove?: boolean;
    }>;
  }
}

async function getNotebookContext(
  syncServerUrl: string | undefined,
  workspaceId: string,
): Promise<string | undefined> {
  if (!syncServerUrl) {
    console.log("[getNotebookContext] No sync server URL");
    return undefined;
  }

  try {
    const url = `${syncServerUrl}/parties/document/workspace-${workspaceId}/markdown`;
    console.log("[getNotebookContext] Fetching from:", url);
    const response = await fetch(url);
    if (!response.ok) {
      console.log("[getNotebookContext] Failed:", response.status);
      return undefined;
    }
    const data = (await response.json()) as { ok: boolean; markdown: string };
    console.log(
      "[getNotebookContext] Got markdown, length:",
      data.markdown?.length,
    );
    return data.markdown;
  } catch (error) {
    console.error("[getNotebookContext] Error:", formatError(error));
    return undefined;
  }
}

async function executeCode(
  sandboxUrl: string,
  workspaceId: string,
  code: string,
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    console.log("[executeCode] Executing code, length:", code.length);
    const response = await fetch(`${sandboxUrl}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        code,
        agent_mode: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[executeCode] Failed:", response.status, text);
      return { success: false, error: text };
    }

    const result = (await response.json()) as {
      success: boolean;
      outputs?: Array<{ type: string; content: string }>;
      error?: string;
    };

    const output = result.outputs
      ?.map((o) => (o.type === "error" ? `Error: ${o.content}` : o.content))
      .join("\n");

    console.log(
      "[executeCode] Success:",
      result.success,
      "output length:",
      output?.length,
    );
    return { success: result.success, output, error: result.error };
  } catch (error) {
    console.error("[executeCode] Error:", formatError(error));
    return { success: false, error: formatError(error) };
  }
}

async function waitForApproval(
  client: ConvexClient,
  agentId: string,
  maxWaitMs: number = 120000,
): Promise<{ approved: boolean; feedback?: string }> {
  const startTime = Date.now();
  const pollInterval = 1000;

  console.log("[waitForApproval] Starting, agentId:", agentId);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const status = await client.checkApprovalStatus(agentId);
      console.log("[waitForApproval] Status:", JSON.stringify(status));

      if (status.autoApprove) {
        return { approved: true };
      }

      if (status.status !== "awaiting_approval") {
        return { approved: status.status === "working" };
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error("[waitForApproval] Error:", formatError(error));
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  console.log("[waitForApproval] Timeout");
  return { approved: false, feedback: "Approval timeout" };
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  agentRole: string,
): Promise<string> {
  console.log(
    `[callLLM:${agentRole}] Starting, prompt length: ${userPrompt.length}, maxTokens: ${maxTokens}`,
  );

  try {
    const result = await generateText({
      model: gateway("anthropic/claude-sonnet-4-20250514"),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });

    console.log(
      `[callLLM:${agentRole}] Success, response length: ${result.text.length}`,
    );
    return result.text;
  } catch (error) {
    console.error(`[callLLM:${agentRole}] Error:`, formatError(error));

    if (error instanceof Error) {
      console.error(`[callLLM:${agentRole}] Error name:`, error.name);
      console.error(`[callLLM:${agentRole}] Error message:`, error.message);
      if ("cause" in error) {
        console.error(`[callLLM:${agentRole}] Error cause:`, error.cause);
      }
      if ("response" in error) {
        console.error(
          `[callLLM:${agentRole}] Error response:`,
          (error as any).response,
        );
      }
    }

    throw error;
  }
}

async function runEngineer(ctx: AgentContext, client: ConvexClient) {
  const config = ROLE_CONFIG.engineer;
  console.log("[runEngineer] Starting for agent:", ctx.agentId);

  await client.updateStatus(
    ctx.agentId,
    "thinking",
    config.activityMessages.start,
  );
  await client.postActivity(ctx.agentId, "thinking", {
    content: config.activityMessages.start,
  });

  const contextPrompt = ctx.notebookContext
    ? `\n\nCurrent notebook context:\n${ctx.notebookContext}`
    : "";

  const designText = await callLLM(
    config.systemPrompt,
    `Hypothesis: ${ctx.hypothesis}${contextPrompt}\n\nDesign a minimal experiment with a parameter sweep (max 4 combinations). Output your analysis and Python code to run.`,
    config.maxTokens,
    "engineer",
  );

  const codeMatch = designText.match(/```python\n([\s\S]*?)```/);
  const code = codeMatch?.[1];

  if (code && ctx.sandboxUrl) {
    console.log("[runEngineer] Found code block, requesting approval");
    await client.postActivity(ctx.agentId, "checkpoint", {
      type: "execute_code",
      preview: code.slice(0, 500),
    });
    await client.requestApproval(ctx.agentId, "execute_code", code);

    const approval = await waitForApproval(client, ctx.agentId);

    if (approval.approved) {
      await client.updateStatus(
        ctx.agentId,
        "working",
        config.activityMessages.execute,
      );
      await client.postActivity(ctx.agentId, "thinking", {
        content: config.activityMessages.execute,
      });

      const execResult = await executeCode(
        ctx.sandboxUrl,
        ctx.workspaceId,
        code,
      );

      if (execResult.success && execResult.output) {
        await client.postActivity(ctx.agentId, "tool-result", {
          toolName: "execute_code",
          output: execResult.output,
        });

        await client.postActivity(ctx.agentId, "thinking", {
          content: config.activityMessages.analyze,
        });

        const analysisText = await callLLM(
          "You are analyzing experiment results. Summarize findings concisely.",
          `Hypothesis: ${ctx.hypothesis}\n\nCode executed:\n\`\`\`python\n${code}\n\`\`\`\n\nOutput:\n${execResult.output}\n\nProvide a brief analysis of these results.`,
          600,
          "engineer-analysis",
        );

        const finalOutput = `## Experiment Design\n\n${designText}\n\n## Results\n\n\`\`\`\n${execResult.output}\n\`\`\`\n\n## Analysis\n\n${analysisText}`;

        await client.postActivity(ctx.agentId, "finding-preview", {
          markdown: finalOutput,
        });
        await client.createFinding(ctx.agentId, finalOutput);
        return { success: true, text: finalOutput };
      } else {
        const errorOutput = `## Experiment Design\n\n${designText}\n\n## Execution Error\n\n${execResult.error || "Unknown error"}`;
        await client.postActivity(ctx.agentId, "error", {
          message: execResult.error,
        });
        await client.createFinding(ctx.agentId, errorOutput);
        return { success: true, text: errorOutput };
      }
    } else {
      const rejectedOutput = `## Experiment Design\n\n${designText}\n\n---\n*Code execution was not approved.*`;
      await client.createFinding(ctx.agentId, rejectedOutput);
      return { success: true, text: rejectedOutput };
    }
  }

  await client.postActivity(ctx.agentId, "finding-preview", {
    markdown: designText,
  });
  await client.createFinding(ctx.agentId, designText);
  return { success: true, text: designText };
}

async function runSimpleAgent(
  role: "researcher" | "reviewer",
  ctx: AgentContext,
  client: ConvexClient,
) {
  const config = ROLE_CONFIG[role];
  console.log(`[runSimpleAgent:${role}] Starting for agent:`, ctx.agentId);

  await client.updateStatus(
    ctx.agentId,
    "thinking",
    config.activityMessages.start,
  );
  await client.postActivity(ctx.agentId, "thinking", {
    content: config.activityMessages.start,
  });

  const contextPrompt = ctx.notebookContext
    ? `\n\nCurrent notebook context:\n${ctx.notebookContext}`
    : "";

  const resultText = await callLLM(
    config.systemPrompt,
    `Hypothesis: ${ctx.hypothesis}${contextPrompt}`,
    config.maxTokens,
    role,
  );

  await client.postActivity(ctx.agentId, "thinking", {
    content: config.activityMessages.analyze,
  });
  await client.postActivity(ctx.agentId, "finding-preview", {
    markdown: resultText,
  });
  await client.createFinding(ctx.agentId, resultText);

  return { success: true, text: resultText };
}

export class HypothesisWorkflow extends WorkflowEntrypoint<
  Env,
  HypothesisWorkflowParams
> {
  async run(
    event: WorkflowEvent<HypothesisWorkflowParams>,
    step: WorkflowStep,
  ) {
    const {
      hypothesis,
      agentIds,
      convexUrl,
      syncKey,
      syncServerUrl,
      sandboxUrl,
    } = event.payload;

    console.log("[HypothesisWorkflow] Starting workflow");
    console.log("[HypothesisWorkflow] convexUrl:", convexUrl);
    console.log("[HypothesisWorkflow] syncServerUrl:", syncServerUrl);
    console.log("[HypothesisWorkflow] sandboxUrl:", sandboxUrl);
    console.log("[HypothesisWorkflow] hypothesis:", hypothesis.slice(0, 100));
    console.log("[HypothesisWorkflow] agentIds:", JSON.stringify(agentIds));

    const client = new ConvexClient(convexUrl, syncKey);

    const notebookContext = await step.do(
      "fetch-notebook-context",
      async () => {
        return getNotebookContext(syncServerUrl, event.payload.workspaceId);
      },
    );

    const runAgent = async (role: AgentRole) => {
      const agentId = agentIds[role];
      console.log(`[HypothesisWorkflow] Running agent ${role}, id: ${agentId}`);

      const ctx: AgentContext = {
        convexUrl,
        syncKey,
        syncServerUrl,
        sandboxUrl,
        workspaceId: event.payload.workspaceId,
        agentId,
        hypothesis,
        notebookContext,
      };

      try {
        let result;
        if (role === "engineer") {
          result = await runEngineer(ctx, client);
        } else {
          result = await runSimpleAgent(role, ctx, client);
        }

        await client.updateStatus(agentId, "done");
        console.log(
          `[HypothesisWorkflow] Agent ${role} completed successfully`,
        );
        return { role, ...result };
      } catch (error) {
        const errorMsg = formatError(error);
        console.error(`[HypothesisWorkflow] Agent ${role} failed:`, errorMsg);

        try {
          await client.postActivity(agentId, "error", { message: errorMsg });
          await client.createFinding(
            agentId,
            `Could not complete analysis: ${errorMsg}`,
          );
          await client.updateStatus(agentId, "error", undefined, errorMsg);
        } catch (reportError) {
          console.error(
            `[HypothesisWorkflow] Failed to report error for ${role}:`,
            formatError(reportError),
          );
        }

        return { role, success: false, error: errorMsg };
      }
    };

    const results = await Promise.allSettled([
      step.do("engineer", { timeout: ROLE_CONFIG.engineer.timeout }, () =>
        runAgent("engineer"),
      ),
      step.do("researcher", { timeout: ROLE_CONFIG.researcher.timeout }, () =>
        runAgent("researcher"),
      ),
      step.do("reviewer", { timeout: ROLE_CONFIG.reviewer.timeout }, () =>
        runAgent("reviewer"),
      ),
    ]);

    console.log("[HypothesisWorkflow] All agents completed");
    return results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: formatError(r.reason) },
    );
  }
}
