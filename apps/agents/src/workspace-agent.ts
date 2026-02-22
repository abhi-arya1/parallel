import {
  Agent,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "agents";
import migrations from "../drizzle/migrations";
import {
  drizzle,
  type DrizzleSqliteDODatabase,
} from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq, desc, and } from "drizzle-orm";
import { smoothStream, streamText, stepCountIs, tool, ToolSet } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Parallel } from "parallel-web";
import {
  activityTable,
  findingsTable,
  stateTable,
  messagesTable,
  conversationsTable,
} from "./db/schema";
import {
  ENGINEER_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
} from "./hypothesis/prompts";

const AGENT_MODEL = gateway("anthropic/claude-sonnet-4-20250514");
const MAX_TURNS = 20;

type AgentRole = "engineer" | "researcher" | "reviewer";
type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "awaiting_approval"
  | "done"
  | "error";

type ClientMessage =
  | {
      type: "start";
      agentId: AgentRole;
      hypothesis: string;
      notebookContext?: string;
    }
  | { type: "steer"; agentId: AgentRole; content: string }
  | { type: "stop"; agentId: AgentRole }
  | { type: "approve"; agentId: AgentRole }
  | { type: "reject"; agentId: AgentRole; feedback?: string }
  | { type: "sync"; agentId: AgentRole }
  | { type: "clear"; agentId: AgentRole };

type Activity = {
  id: string;
  type: string;
  content: unknown;
  streamId?: string;
  isPartial?: boolean;
  createdAt: number;
};

type Finding = {
  id: string;
  content: string;
  cellType: string;
  createdAt: number;
  syncedToNotebook: boolean;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

const MAX_SEARCH_QUERIES = 5;

const searchWebInputSchema = z.object({
  objective: z
    .string()
    .describe("Natural-language description of what the web research goal is."),
  queries: z
    .array(z.string())
    .max(MAX_SEARCH_QUERIES)
    .optional()
    .describe(
      `List of keyword search queries of 1-6 words. Maximum ${MAX_SEARCH_QUERIES} queries.`,
    ),
  maxResults: z.number().min(1).max(20).default(10),
});

const searchArxivInputSchema = z.object({
  query: z.string().describe("Search query for academic papers"),
  maxResults: z.number().min(1).max(10).default(5),
});

type ExtractType = "focused" | "detailed" | "full_page";

const extractInputSchema = z.object({
  objective: z
    .string()
    .describe(
      "Natural-language description of what information you're looking for from the URLs.",
    ),
  urls: z
    .array(z.string())
    .max(10)
    .describe("List of URLs to extract content from. Maximum 10 URLs."),
  queries: z
    .array(z.string())
    .max(MAX_SEARCH_QUERIES)
    .optional()
    .describe(
      `Optional keyword queries to emphasize specific terms. Maximum ${MAX_SEARCH_QUERIES} queries.`,
    ),
  extractType: z
    .enum(["focused", "detailed", "full_page"])
    .optional()
    .default("focused")
    .describe(
      "Controls extraction depth. 'focused' for quick relevant excerpts (default), 'detailed' for comprehensive excerpts, 'full_page' for complete page content.",
    ),
  freshness: z
    .enum(["cached", "fresh"])
    .optional()
    .default("cached")
    .describe(
      "Content freshness. 'cached' for fast indexed content (default), 'fresh' to fetch live content.",
    ),
});

function getExtractSettings(extractType: ExtractType): {
  excerpts: boolean | { max_chars_per_result: number };
  full_content: boolean | { max_chars_per_result: number };
} {
  switch (extractType) {
    case "focused":
      return {
        excerpts: { max_chars_per_result: 5000 },
        full_content: false,
      };
    case "detailed":
      return {
        excerpts: { max_chars_per_result: 15000 },
        full_content: false,
      };
    case "full_page":
      return {
        excerpts: false,
        full_content: { max_chars_per_result: 30000 },
      };
  }
}

const executeCodeInputSchema = z.object({
  code: z.string().describe("Python code to execute"),
});

const bashInputSchema = z.object({
  command: z.string().describe("Bash command to execute"),
});

class ConvexClient {
  constructor(private convexUrl: string) {}

  private async mutation(name: string, args: Record<string, unknown>) {
    const res = await fetch(`${this.convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: name, args }),
    });
    if (!res.ok) throw new Error(`Convex mutation failed: ${res.status}`);
    return ((await res.json()) as { value?: unknown }).value;
  }

  async createFinding(
    workspaceId: string,
    role: string,
    content: string,
    cellType = "markdown",
  ) {
    return this.mutation("agents:createAgentFinding", {
      workspaceId,
      role,
      content,
      cellType,
    });
  }

  async updateAgentStatus(workspaceId: string, role: string, status: string) {
    return this.mutation("agents:updateAgentStatus", {
      workspaceId,
      role,
      status,
    });
  }

  async postActivity(
    workspaceId: string,
    role: string,
    contentType: string,
    content: unknown,
  ) {
    return this.mutation("agents:postAgentActivity", {
      workspaceId,
      role,
      contentType,
      content,
    });
  }
}

export class WorkspaceAgent extends Agent<Env> {
  storage: DurableObjectStorage;
  db: DrizzleSqliteDODatabase;
  connections: Set<Connection> = new Set();
  abortControllers: Map<AgentRole, AbortController> = new Map();
  convex: ConvexClient | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    if (env.CONVEX_URL) this.convex = new ConvexClient(env.CONVEX_URL);

    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  get workspaceId(): string {
    return this.name;
  }

  async onConnect(
    connection: Connection,
    _ctx: ConnectionContext,
  ): Promise<void> {
    this.connections.add(connection);
  }

  async onClose(connection: Connection): Promise<void> {
    this.connections.delete(connection);
  }

  async onMessage(_connection: Connection, message: WSMessage): Promise<void> {
    if (typeof message !== "string") return;
    const msg = JSON.parse(message) as ClientMessage;
    const agentId = msg.agentId;
    console.log(`[WorkspaceAgent] Received message:`, msg.type, agentId);

    switch (msg.type) {
      case "start":
        await this.handleStart(agentId, msg.hypothesis, msg.notebookContext);
        break;
      case "steer":
        await this.handleSteer(agentId, msg.content);
        break;
      case "stop":
        await this.handleStop(agentId);
        break;
      case "approve":
        await this.handleApprove(agentId);
        break;
      case "reject":
        await this.handleReject(agentId, msg.feedback);
        break;
      case "sync":
        await this.sendAgentState(agentId);
        break;
      case "clear":
        await this.handleClear(agentId);
        break;
    }
  }

  async sendAgentState(agentId: AgentRole): Promise<void> {
    const [activity, findings, messages, status] = await Promise.all([
      this.getActivity(agentId),
      this.getFindings(agentId),
      this.getMessages(agentId),
      this.getKV(agentId, "status"),
    ]);
    this.broadcast({
      type: "state",
      agentId,
      status: status || "idle",
      activity,
      findings,
      messages,
    });
  }

  broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const conn of this.connections) {
      try {
        conn.send(msg);
      } catch {
        this.connections.delete(conn);
      }
    }
  }

  async handleStart(
    agentId: AgentRole,
    hypothesis: string,
    notebookContext?: string,
  ): Promise<void> {
    await this.setKV(agentId, "status", "thinking");
    await this.convex?.updateAgentStatus(this.workspaceId, agentId, "thinking");
    this.broadcast({ type: "status", agentId, status: "thinking" });

    const systemPrompt = this.getSystemPrompt(agentId);
    const contextPart = notebookContext
      ? `\n\nNotebook context:\n${notebookContext}`
      : "";
    await this.addMessage(agentId, "user", hypothesis);
    await this.runAgent(
      agentId,
      systemPrompt,
      `Hypothesis: ${hypothesis}${contextPart}`,
    );
  }

  async handleSteer(agentId: AgentRole, content: string): Promise<void> {
    const status = await this.getKV(agentId, "status");
    if (["idle", "done", "error"].includes(status || "")) {
      await this.setKV(agentId, "status", "thinking");
      await this.convex?.updateAgentStatus(
        this.workspaceId,
        agentId,
        "thinking",
      );
      this.broadcast({ type: "status", agentId, status: "thinking" });
    }
    await this.addMessage(agentId, "user", content);
    const messages = await this.getMessages(agentId);
    await this.runAgent(
      agentId,
      this.getSystemPrompt(agentId),
      messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
    );
  }

  async handleStop(agentId: AgentRole): Promise<void> {
    const controller = this.abortControllers.get(agentId);
    controller?.abort();
    this.abortControllers.delete(agentId);
    await this.setKV(agentId, "status", "idle");
    await this.convex?.updateAgentStatus(this.workspaceId, agentId, "idle");
    this.broadcast({ type: "status", agentId, status: "idle" });
  }

  async handleApprove(agentId: AgentRole): Promise<void> {
    const pendingCode = await this.getKV(agentId, "pendingCode");
    if (!pendingCode) return;

    await this.setKV(agentId, "status", "working");
    await this.convex?.updateAgentStatus(this.workspaceId, agentId, "working");
    this.broadcast({ type: "status", agentId, status: "working" });

    try {
      const result = await this.executeCode(pendingCode);
      await this.addActivity(agentId, "tool-result", {
        toolName: "execute_code",
        output: result,
      });
      await this.convex?.postActivity(
        this.workspaceId,
        agentId,
        "tool-result",
        {
          toolName: "execute_code",
          output: result,
        },
      );
      this.broadcast({
        type: "tool-result",
        agentId,
        toolName: "execute_code",
        output: result,
      });
      await this.setKV(agentId, "pendingCode", null);
      await this.setKV(agentId, "status", "done");
      await this.convex?.updateAgentStatus(this.workspaceId, agentId, "done");
      this.broadcast({ type: "status", agentId, status: "done" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Execution failed";
      await this.addActivity(agentId, "error", { message: errMsg });
      await this.setKV(agentId, "status", "error");
      await this.convex?.updateAgentStatus(this.workspaceId, agentId, "error");
      this.broadcast({ type: "error", agentId, message: errMsg });
    }
  }

  async handleReject(agentId: AgentRole, feedback?: string): Promise<void> {
    await this.setKV(agentId, "pendingCode", null);
    await this.setKV(agentId, "status", "done");
    await this.addActivity(agentId, "approval", { approved: false, feedback });
    await this.convex?.updateAgentStatus(this.workspaceId, agentId, "done");
    this.broadcast({ type: "status", agentId, status: "done" });
  }

  async handleClear(agentId: AgentRole): Promise<void> {
    const controller = this.abortControllers.get(agentId);
    controller?.abort();
    this.abortControllers.delete(agentId);

    await this.db
      .delete(activityTable)
      .where(eq(activityTable.agentId, agentId));
    await this.db
      .delete(findingsTable)
      .where(eq(findingsTable.agentId, agentId));
    await this.db
      .delete(messagesTable)
      .where(eq(messagesTable.agentId, agentId));
    await this.db
      .delete(conversationsTable)
      .where(eq(conversationsTable.agentId, agentId));
    await this.db.delete(stateTable).where(eq(stateTable.agentId, agentId));

    await this.convex?.updateAgentStatus(this.workspaceId, agentId, "idle");
    await this.sendAgentState(agentId);
  }

  getSystemPrompt(agentId: AgentRole): string {
    return agentId === "engineer"
      ? ENGINEER_SYSTEM_PROMPT
      : agentId === "researcher"
        ? RESEARCHER_SYSTEM_PROMPT
        : REVIEWER_SYSTEM_PROMPT;
  }

  createResearcherTools(agentId: AgentRole): ToolSet {
    const parallel = new Parallel({ apiKey: this.env.PARALLEL_API_KEY });

    return {
      searchWeb: tool({
        description:
          "Search the web for information relevant to a research objective",
        inputSchema: searchWebInputSchema,
        execute: async (args: z.infer<typeof searchWebInputSchema>) => {
          const searchParams = {
            mode: "agentic" as const,
            objective: args.objective,
            search_queries: args.queries?.slice(0, MAX_SEARCH_QUERIES),
            max_results: args.maxResults,
          };

          const results = await parallel.beta.search(searchParams);

          return {
            searchParams: args,
            answer: results,
          };
        },
      }),
      searchArxiv: tool({
        description: "Search arXiv for academic papers and preprints",
        inputSchema: searchArxivInputSchema,
        execute: async (args: z.infer<typeof searchArxivInputSchema>) => {
          const searchParams = {
            mode: "agentic" as const,
            objective: `Find academic papers about: ${args.query}`,
            search_queries: [args.query],
            max_results: args.maxResults,
            site_filter: ["arxiv.org"],
          };

          const results = await parallel.beta.search(searchParams);

          return {
            searchParams: args,
            answer: results,
          };
        },
      }),
      extract: tool({
        description:
          "Extract content from specific URLs. Use this when you have URLs you want to read and extract information from.",
        inputSchema: extractInputSchema,
        execute: async (args: z.infer<typeof extractInputSchema>) => {
          const extractSettings = getExtractSettings(
            args.extractType ?? "focused",
          );

          const fetchPolicy =
            args.freshness === "fresh"
              ? {
                  max_age_seconds: 600,
                  timeout_seconds: 60,
                }
              : undefined;

          const extractParams = {
            urls: args.urls.slice(0, 10),
            objective: args.objective,
            search_queries: args.queries?.slice(0, MAX_SEARCH_QUERIES),
            ...extractSettings,
            ...(fetchPolicy && { fetch_policy: fetchPolicy }),
          };

          const results = await parallel.beta.extract(extractParams);

          return {
            extractParams: args,
            answer: results,
          };
        },
      }),
    };
  }

  createEngineerTools(agentId: AgentRole): ToolSet {
    const agent = this;
    return {
      executeCode: tool({
        description: "Execute Python code in a sandbox",
        inputSchema: executeCodeInputSchema,
        execute: async (args: z.infer<typeof executeCodeInputSchema>) => {
          await agent.setKV(agentId, "pendingCode", args.code);
          await agent.setKV(agentId, "status", "awaiting_approval");
          await agent.convex?.updateAgentStatus(
            agent.workspaceId,
            agentId,
            "awaiting_approval",
          );
          agent.broadcast({
            type: "needs-approval",
            agentId,
            action: "execute_code",
            code: args.code,
          });
          return { pending: true, message: "Awaiting user approval" };
        },
      }),
      bash: tool({
        description: "Execute a bash command",
        inputSchema: bashInputSchema,
        execute: async (args: z.infer<typeof bashInputSchema>) => {
          const res = await fetch(`${agent.env.SANDBOX_URL}/bash`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: args.command,
              workspaceId: agent.workspaceId,
            }),
          });
          return res.json();
        },
      }),
    };
  }

  getTools(agentId: AgentRole): ToolSet {
    if (agentId === "researcher") {
      return this.createResearcherTools(agentId);
    }
    if (agentId === "engineer") {
      return this.createEngineerTools(agentId);
    }
    return {};
  }

  async runAgent(
    agentId: AgentRole,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<void> {
    const existingController = this.abortControllers.get(agentId);
    existingController?.abort();

    const abortController = new AbortController();
    this.abortControllers.set(agentId, abortController);

    const streamId = nanoid();
    let fullText = "";
    let lastBroadcast = 0;
    const tools = this.getTools(agentId);

    try {
      const { textStream } = streamText({
        model: AGENT_MODEL,
        system: systemPrompt,
        prompt: userPrompt,
        tools,
        stopWhen: stepCountIs(MAX_TURNS),
        experimental_transform: smoothStream({
          delayInMs: 20,
          chunking: "word",
        }),
        abortSignal: abortController.signal,
        onChunk: ({ chunk }) => {
          if (chunk.type === "text-delta") {
            fullText += chunk.text;
            if (Date.now() - lastBroadcast > 50) {
              this.broadcast({
                type: "text-delta",
                agentId,
                text: fullText,
                streamId,
              });
              lastBroadcast = Date.now();
            }
          } else if (chunk.type === "tool-call") {
            const input = "args" in chunk ? chunk.args : undefined;
            this.addActivity(agentId, "tool-call", {
              toolName: chunk.toolName,
              input,
            });
            this.broadcast({
              type: "tool-call",
              agentId,
              toolName: chunk.toolName,
              input,
            });
          } else if (chunk.type === "tool-result") {
            this.addActivity(agentId, "tool-result", {
              toolName: chunk.toolName,
              output: chunk.output,
            });
            this.broadcast({
              type: "tool-result",
              agentId,
              toolName: chunk.toolName,
              output: chunk.output,
            });
          }
        },
        onFinish: async ({ text }) => {
          // Use accumulated fullText since text may only be last step
          const finalText = fullText || text;
          await this.addMessage(agentId, "assistant", finalText);
          await this.createFinding(agentId, finalText);
          await this.setKV(agentId, "status", "done");
          await this.convex?.updateAgentStatus(
            this.workspaceId,
            agentId,
            "done",
          );
          this.broadcast({ type: "finish", agentId, text: finalText });
          this.broadcast({ type: "status", agentId, status: "done" });
        },
        onError: async ({ error }) => {
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
          await this.addActivity(agentId, "error", { message: errMsg });
          await this.setKV(agentId, "status", "error");
          await this.convex?.updateAgentStatus(
            this.workspaceId,
            agentId,
            "error",
          );
          this.broadcast({ type: "error", agentId, message: errMsg });
        },
      });

      // Consume the stream to drive the callbacks
      for await (const _ of textStream) {
        // onChunk handles broadcasting
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      await this.addActivity(agentId, "error", { message: errMsg });
      await this.setKV(agentId, "status", "error");
      await this.convex?.updateAgentStatus(this.workspaceId, agentId, "error");
      this.broadcast({ type: "error", agentId, message: errMsg });
    } finally {
      this.abortControllers.delete(agentId);
    }
  }

  async executeCode(code: string): Promise<unknown> {
    const res = await fetch(`${this.env.SANDBOX_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, workspaceId: this.workspaceId }),
    });
    return res.json();
  }

  async getKV(agentId: AgentRole, key: string): Promise<string | null> {
    const row = await this.db
      .select()
      .from(stateTable)
      .where(and(eq(stateTable.agentId, agentId), eq(stateTable.key, key)))
      .get();
    return row?.value ?? null;
  }

  async setKV(
    agentId: AgentRole,
    key: string,
    value: string | null,
  ): Promise<void> {
    if (value === null) {
      await this.db
        .delete(stateTable)
        .where(and(eq(stateTable.agentId, agentId), eq(stateTable.key, key)));
    } else {
      await this.db
        .insert(stateTable)
        .values({ agentId, key, value })
        .onConflictDoUpdate({
          target: [stateTable.agentId, stateTable.key],
          set: { value },
        });
    }
  }

  async addActivity(
    agentId: AgentRole,
    type: string,
    content: unknown,
    streamId?: string,
    isPartial = false,
  ): Promise<void> {
    await this.db.insert(activityTable).values({
      id: nanoid(),
      agentId,
      type,
      content: content as Record<string, unknown>,
      streamId,
      isPartial: isPartial ? 1 : 0,
      createdAt: Date.now(),
    });
  }

  async getActivity(agentId: AgentRole): Promise<Activity[]> {
    const rows = await this.db
      .select()
      .from(activityTable)
      .where(eq(activityTable.agentId, agentId))
      .orderBy(activityTable.createdAt);
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      streamId: r.streamId ?? undefined,
      isPartial: r.isPartial === 1,
      createdAt: r.createdAt,
    }));
  }

  async addMessage(
    agentId: AgentRole,
    role: "user" | "assistant",
    content: string,
  ): Promise<void> {
    const convId = agentId;
    const now = new Date().toISOString();
    const existing = await this.db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId))
      .get();
    if (!existing) {
      await this.db
        .insert(conversationsTable)
        .values({ id: convId, agentId, createdAt: now, updatedAt: now });
    }
    const lastMsg = await this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, convId))
      .orderBy(desc(messagesTable.sequence))
      .limit(1)
      .get();
    await this.db.insert(messagesTable).values({
      conversationId: convId,
      agentId,
      sequence: (lastMsg?.sequence ?? 0) + 1,
      role,
      content: content as unknown as Record<string, unknown>,
      sentAt: now,
    });
  }

  async getMessages(agentId: AgentRole): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.agentId, agentId))
      .orderBy(messagesTable.sequence);
    return rows.map((r) => ({
      role: r.role as "user" | "assistant",
      content:
        typeof r.content === "string" ? r.content : JSON.stringify(r.content),
      timestamp: new Date(r.sentAt).getTime(),
    }));
  }

  async createFinding(
    agentId: AgentRole,
    content: string,
    cellType = "markdown",
  ): Promise<void> {
    const id = nanoid();
    await this.db.insert(findingsTable).values({
      id,
      agentId,
      content,
      cellType,
      createdAt: Date.now(),
      syncedToNotebook: 0,
    });
    await this.convex?.createFinding(
      this.workspaceId,
      agentId,
      content,
      cellType,
    );
    this.broadcast({ type: "finding", agentId, id, content, cellType });
  }

  async getFindings(agentId: AgentRole): Promise<Finding[]> {
    const rows = await this.db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.agentId, agentId))
      .orderBy(findingsTable.createdAt);
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      cellType: r.cellType ?? "markdown",
      createdAt: r.createdAt,
      syncedToNotebook: r.syncedToNotebook === 1,
    }));
  }
}
