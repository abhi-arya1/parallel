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
import { eq, desc } from "drizzle-orm";
import { smoothStream, streamText, stepCountIs, tool, ToolSet } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { nanoid } from "nanoid";
import { z } from "zod";
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
  | { type: "start"; hypothesis: string; notebookContext?: string }
  | { type: "steer"; content: string }
  | { type: "stop" }
  | { type: "approve" }
  | { type: "reject"; feedback?: string }
  | { type: "sync" }
  | { type: "clear" }
  | { type: "set-auto-approve"; value: boolean };

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

const searchWebInputSchema = z.object({
  query: z.string().describe("Search query"),
});

const searchArxivInputSchema = z.object({
  query: z.string().describe("Search query for academic papers"),
  maxResults: z.number().optional().describe("Maximum number of results"),
});

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

export class PersonaAgent extends Agent<Env> {
  storage: DurableObjectStorage;
  db: DrizzleSqliteDODatabase;
  connections: Set<Connection> = new Set();
  role: AgentRole = "researcher";
  workspaceId = "";
  abortController: AbortController | null = null;
  convex: ConvexClient | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    const parts = this.name.split("-");
    if (parts.length >= 2) {
      this.role = parts[0] as AgentRole;
      this.workspaceId = parts.slice(1).join("-");
    }

    if (env.CONVEX_URL) this.convex = new ConvexClient(env.CONVEX_URL);

    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  async onConnect(
    connection: Connection,
    _ctx: ConnectionContext,
  ): Promise<void> {
    this.connections.add(connection);
    await this.sendState(connection);
  }

  async onClose(connection: Connection): Promise<void> {
    this.connections.delete(connection);
  }

  async onMessage(_connection: Connection, message: WSMessage): Promise<void> {
    if (typeof message !== "string") return;
    const msg = JSON.parse(message) as ClientMessage;

    switch (msg.type) {
      case "start":
        await this.handleStart(msg.hypothesis, msg.notebookContext);
        break;
      case "steer":
        await this.handleSteer(msg.content);
        break;
      case "stop":
        await this.handleStop();
        break;
      case "approve":
        await this.handleApprove();
        break;
      case "reject":
        await this.handleReject(msg.feedback);
        break;
      case "sync":
        await this.broadcastState();
        break;
      case "clear":
        await this.handleClear();
        break;
      case "set-auto-approve":
        await this.setAutoApprove(msg.value);
        break;
    }
  }

  async sendState(connection: Connection): Promise<void> {
    const [activity, findings, messages, status, autoApprove] =
      await Promise.all([
        this.getActivity(),
        this.getFindings(),
        this.getMessages(),
        this.getKV("status"),
        this.getKV("autoApprove"),
      ]);
    connection.send(
      JSON.stringify({
        type: "state",
        role: this.role,
        status: status || "idle",
        autoApprove: autoApprove === "true",
        activity,
        findings,
        messages,
      }),
    );
  }

  async broadcastState(): Promise<void> {
    const [activity, findings, messages, status, autoApprove] =
      await Promise.all([
        this.getActivity(),
        this.getFindings(),
        this.getMessages(),
        this.getKV("status"),
        this.getKV("autoApprove"),
      ]);
    this.broadcast({
      type: "state",
      role: this.role,
      status: status || "idle",
      autoApprove: autoApprove === "true",
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
    hypothesis: string,
    notebookContext?: string,
  ): Promise<void> {
    await this.setKV("status", "thinking");
    await this.convex?.updateAgentStatus(
      this.workspaceId,
      this.role,
      "thinking",
    );
    this.broadcast({ type: "status", role: this.role, status: "thinking" });

    const systemPrompt = this.getSystemPrompt();
    const contextPart = notebookContext
      ? `\n\nNotebook context:\n${notebookContext}`
      : "";
    await this.addMessage("user", hypothesis);
    await this.runAgent(
      systemPrompt,
      `Hypothesis: ${hypothesis}${contextPart}`,
    );
  }

  async handleSteer(content: string): Promise<void> {
    const status = await this.getKV("status");
    if (["idle", "done", "error"].includes(status || "")) {
      await this.setKV("status", "thinking");
      await this.convex?.updateAgentStatus(
        this.workspaceId,
        this.role,
        "thinking",
      );
      this.broadcast({ type: "status", role: this.role, status: "thinking" });
    }
    await this.addMessage("user", content);
    const messages = await this.getMessages();
    await this.runAgent(
      this.getSystemPrompt(),
      messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
    );
  }

  async handleStop(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    await this.setKV("status", "idle");
    await this.convex?.updateAgentStatus(this.workspaceId, this.role, "idle");
    this.broadcast({ type: "status", role: this.role, status: "idle" });
  }

  async handleApprove(): Promise<void> {
    const pendingCode = await this.getKV("pendingCode");
    if (!pendingCode) return;

    await this.setKV("status", "working");
    await this.convex?.updateAgentStatus(
      this.workspaceId,
      this.role,
      "working",
    );
    this.broadcast({ type: "status", role: this.role, status: "working" });

    try {
      const result = await this.executeCode(pendingCode);
      await this.addActivity("tool-result", {
        toolName: "execute_code",
        output: result,
      });
      await this.convex?.postActivity(
        this.workspaceId,
        this.role,
        "tool-result",
        { toolName: "execute_code", output: result },
      );
      this.broadcast({
        type: "tool-result",
        role: this.role,
        toolName: "execute_code",
        output: result,
      });
      await this.setKV("pendingCode", null);
      await this.setKV("status", "done");
      await this.convex?.updateAgentStatus(this.workspaceId, this.role, "done");
      this.broadcast({ type: "status", role: this.role, status: "done" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Execution failed";
      await this.addActivity("error", { message: errMsg });
      await this.setKV("status", "error");
      await this.convex?.updateAgentStatus(
        this.workspaceId,
        this.role,
        "error",
      );
      this.broadcast({ type: "error", role: this.role, message: errMsg });
    }
  }

  async handleReject(feedback?: string): Promise<void> {
    await this.setKV("pendingCode", null);
    await this.setKV("status", "done");
    await this.addActivity("approval", { approved: false, feedback });
    await this.convex?.updateAgentStatus(this.workspaceId, this.role, "done");
    this.broadcast({ type: "status", role: this.role, status: "done" });
  }

  async handleClear(): Promise<void> {
    await this.db.delete(activityTable);
    await this.db.delete(findingsTable);
    await this.db.delete(messagesTable);
    await this.db.delete(conversationsTable);
    await this.setKV("status", "idle");
    await this.setKV("pendingCode", null);
    await this.convex?.updateAgentStatus(this.workspaceId, this.role, "idle");
    await this.broadcastState();
  }

  async setAutoApprove(value: boolean): Promise<void> {
    await this.setKV("autoApprove", value ? "true" : "false");
    this.broadcast({ type: "auto-approve", role: this.role, value });
  }

  getSystemPrompt(): string {
    return this.role === "engineer"
      ? ENGINEER_SYSTEM_PROMPT
      : this.role === "researcher"
        ? RESEARCHER_SYSTEM_PROMPT
        : REVIEWER_SYSTEM_PROMPT;
  }

  createResearcherTools(): ToolSet {
    const agent = this;
    return {
      searchWeb: tool({
        description: "Search the web for information",
        inputSchema: searchWebInputSchema,
        execute: async (args: z.infer<typeof searchWebInputSchema>) => {
          const res = await fetch(
            `https://api.parallel.ai/v1/search?q=${encodeURIComponent(args.query)}`,
            {
              headers: {
                Authorization: `Bearer ${agent.env.PARALLEL_API_KEY}`,
              },
            },
          );
          return res.json();
        },
      }),
      searchArxiv: tool({
        description: "Search arXiv for academic papers",
        inputSchema: searchArxivInputSchema,
        execute: async (args: z.infer<typeof searchArxivInputSchema>) => {
          const res = await fetch(
            `https://api.parallel.ai/v1/arxiv?q=${encodeURIComponent(args.query)}&max=${args.maxResults ?? 5}`,
            {
              headers: {
                Authorization: `Bearer ${agent.env.PARALLEL_API_KEY}`,
              },
            },
          );
          return res.json();
        },
      }),
    };
  }

  createEngineerTools(): ToolSet {
    const agent = this;
    return {
      executeCode: tool({
        description: "Execute Python code in a sandbox",
        inputSchema: executeCodeInputSchema,
        execute: async (args: z.infer<typeof executeCodeInputSchema>) => {
          if ((await agent.getKV("autoApprove")) === "true") {
            return agent.executeCode(args.code);
          }
          await agent.setKV("pendingCode", args.code);
          await agent.setKV("status", "awaiting_approval");
          await agent.convex?.updateAgentStatus(
            agent.workspaceId,
            agent.role,
            "awaiting_approval",
          );
          agent.broadcast({
            type: "needs-approval",
            role: agent.role,
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

  getTools(): ToolSet {
    if (this.role === "researcher") {
      return this.createResearcherTools();
    }
    if (this.role === "engineer") {
      return this.createEngineerTools();
    }
    return {};
  }

  async runAgent(systemPrompt: string, userPrompt: string): Promise<void> {
    this.abortController = new AbortController();
    const streamId = nanoid();
    let fullText = "";
    const tools = this.getTools();

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
        abortSignal: this.abortController.signal,
        onChunk: async ({ chunk }) => {
          if (chunk.type === "tool-call") {
            const input = "input" in chunk ? chunk.input : undefined;
            await this.addActivity("tool-call", {
              toolName: chunk.toolName,
              input,
            });
            await this.convex?.postActivity(
              this.workspaceId,
              this.role,
              "tool-call",
              { toolName: chunk.toolName, input },
            );
            this.broadcast({
              type: "tool-call",
              role: this.role,
              toolName: chunk.toolName,
              input,
            });
          } else if (chunk.type === "tool-result") {
            await this.addActivity("tool-result", {
              toolName: chunk.toolName,
              output: chunk.output,
            });
            await this.convex?.postActivity(
              this.workspaceId,
              this.role,
              "tool-result",
              { toolName: chunk.toolName, output: chunk.output },
            );
            this.broadcast({
              type: "tool-result",
              role: this.role,
              toolName: chunk.toolName,
              output: chunk.output,
            });
          }
        },
        onFinish: async ({ text }) => {
          await this.addActivity(
            "reasoning",
            { content: text },
            streamId,
            false,
          );
          await this.addMessage("assistant", text);
          await this.createFinding(text);
          await this.setKV("status", "done");
          await this.convex?.updateAgentStatus(
            this.workspaceId,
            this.role,
            "done",
          );
          this.broadcast({ type: "finish", role: this.role, text });
          this.broadcast({ type: "status", role: this.role, status: "done" });
        },
        onError: async ({ error }) => {
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
          await this.addActivity("error", { message: errMsg });
          await this.setKV("status", "error");
          await this.convex?.updateAgentStatus(
            this.workspaceId,
            this.role,
            "error",
          );
          this.broadcast({ type: "error", role: this.role, message: errMsg });
        },
      });

      let lastBroadcast = 0;
      for await (const chunk of textStream) {
        fullText += chunk;
        if (Date.now() - lastBroadcast > 50) {
          this.broadcast({
            type: "text-delta",
            role: this.role,
            text: fullText,
            streamId,
          });
          lastBroadcast = Date.now();
        }
      }
      await this.addActivity(
        "reasoning",
        { content: fullText },
        streamId,
        false,
      );
    } catch (error) {
      if (this.abortController?.signal.aborted) return;
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      await this.addActivity("error", { message: errMsg });
      await this.setKV("status", "error");
      await this.convex?.updateAgentStatus(
        this.workspaceId,
        this.role,
        "error",
      );
      this.broadcast({ type: "error", role: this.role, message: errMsg });
    } finally {
      this.abortController = null;
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

  async getKV(key: string): Promise<string | null> {
    const row = await this.db
      .select()
      .from(stateTable)
      .where(eq(stateTable.key, key))
      .get();
    return row?.value ?? null;
  }

  async setKV(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.db.delete(stateTable).where(eq(stateTable.key, key));
    } else {
      await this.db
        .insert(stateTable)
        .values({ key, value })
        .onConflictDoUpdate({ target: stateTable.key, set: { value } });
    }
  }

  async addActivity(
    type: string,
    content: unknown,
    streamId?: string,
    isPartial = false,
  ): Promise<void> {
    await this.db.insert(activityTable).values({
      id: nanoid(),
      type,
      content: content as Record<string, unknown>,
      streamId,
      isPartial: isPartial ? 1 : 0,
      createdAt: Date.now(),
    });
  }

  async getActivity(): Promise<Activity[]> {
    const rows = await this.db
      .select()
      .from(activityTable)
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

  async addMessage(role: "user" | "assistant", content: string): Promise<void> {
    const convId = "main";
    const now = new Date().toISOString();
    const existing = await this.db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId))
      .get();
    if (!existing) {
      await this.db
        .insert(conversationsTable)
        .values({ id: convId, createdAt: now, updatedAt: now });
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
      sequence: (lastMsg?.sequence ?? 0) + 1,
      role,
      content: content as unknown as Record<string, unknown>,
      sentAt: now,
    });
  }

  async getMessages(): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, "main"))
      .orderBy(messagesTable.sequence);
    return rows.map((r) => ({
      role: r.role as "user" | "assistant",
      content:
        typeof r.content === "string" ? r.content : JSON.stringify(r.content),
      timestamp: new Date(r.sentAt).getTime(),
    }));
  }

  async createFinding(content: string, cellType = "markdown"): Promise<void> {
    const id = nanoid();
    await this.db.insert(findingsTable).values({
      id,
      content,
      cellType,
      createdAt: Date.now(),
      syncedToNotebook: 0,
    });
    await this.convex?.createFinding(
      this.workspaceId,
      this.role,
      content,
      cellType,
    );
    this.broadcast({ type: "finding", role: this.role, id, content, cellType });
  }

  async getFindings(): Promise<Finding[]> {
    const rows = await this.db
      .select()
      .from(findingsTable)
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
