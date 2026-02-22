import { routePartykitRequest, Server } from "partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import type { CallbackOptions } from "y-partyserver";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import debounce from "lodash.debounce";

/**
 * Document Durable Object for Y.js collaboration
 *
 * Each workspace gets its own Document instance that:
 * 1. Maintains the Y.Doc in memory
 * 2. Persists to SQLite on the Durable Object
 * 3. Syncs cell snapshots to Convex on save
 * 4. Loads cells from Convex when no local state exists
 */
export class Document extends YServer {
  // Callback options for debouncing saves
  static callbackOptions: CallbackOptions = {
    debounceWait: 1000, // Wait 1s after last change
    debounceMaxWait: 10000, // Force save after 10s of continuous changes
    timeout: 10000,
  };

  // Enable hibernation for cost efficiency
  static options = {
    hibernate: true,
  };

  private _convexClient: ConvexHttpClient | null = null;
  private _debouncedSync: ReturnType<typeof debounce> | null = null;

  /** Debounced sync — ensures ALL Y.js changes (including nested map values) trigger a Convex sync */
  private getDebouncedSync() {
    if (!this._debouncedSync) {
      this._debouncedSync = debounce(
        () => {
          this.syncToConvex();
        },
        1000,
        { maxWait: 10000 },
      );
    }
    return this._debouncedSync;
  }

  /** Lazily initialize the ConvexHttpClient */
  private getConvexClient(): ConvexHttpClient | null {
    if (this._convexClient) return this._convexClient;
    const url = this.env.CONVEX_URL;
    if (!url) {
      console.warn(
        "[Document] CONVEX_URL not configured, skipping Convex sync",
      );
      return null;
    }
    this._convexClient = new ConvexHttpClient(url);
    return this._convexClient;
  }

  /** Parse workspaceId from room name (format: "workspace-{id}") */
  private getWorkspaceId(): string | null {
    const match = this.name.match(/^workspace-(.+)$/);
    return match ? match[1] : null;
  }

  /**
   * Called when the Durable Object is first created
   * Initialize the SQLite table for document storage
   */
  async onStart() {
    console.log(`[Document] onStart for room: ${this.name}`);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content BLOB,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    return super.onStart();
  }

  /**
   * Called when loading the document from storage
   * Retrieves the Y.Doc state from SQLite, then merges any Convex cells
   */
  async onLoad() {
    console.log(`[Document] onLoad for room: ${this.name}`);

    const rows = [
      ...this.ctx.storage.sql.exec(
        "SELECT content FROM documents WHERE id = ? LIMIT 1",
        this.name,
      ),
    ];

    if (rows.length > 0 && rows[0].content) {
      const content = rows[0].content as ArrayBuffer;
      Y.applyUpdate(this.document, new Uint8Array(content));
      console.log(`[Document] Loaded existing document for room: ${this.name}`);
    } else {
      console.log(`[Document] No existing document for room: ${this.name}`);
      // No local state — try loading from Convex
      await this.loadFromConvex();
    }

    // Observe ALL document updates (including nested Y.Map value changes like status)
    // and debounce a Convex sync. This catches changes that onSave may miss.
    this.document.on("update", () => {
      this.getDebouncedSync()();
    });
  }

  /**
   * Load Y.js state from Convex.
   * Tries the binary snapshot first (fast, preserves full CRDT state).
   * Falls back to reconstructing from individual cell records.
   */
  private async loadFromConvex() {
    const client = this.getConvexClient();
    if (!client) return;

    const workspaceId = this.getWorkspaceId();
    if (!workspaceId) {
      console.warn(
        "[Document] Could not parse workspaceId from room name:",
        this.name,
      );
      return;
    }

    const syncKey = this.env.INTERNAL_API_KEY;
    if (!syncKey) {
      console.warn(
        "[Document] INTERNAL_API_KEY not configured, skipping Convex load",
      );
      return;
    }

    // Try snapshot first
    try {
      const snapshotUrl = await client.query(anyApi.sync.getSnapshot, {
        syncKey,
        workspaceId,
      });

      if (snapshotUrl) {
        console.log("[Document] Downloading Y.js snapshot from Convex...");
        const res = await fetch(snapshotUrl);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          Y.applyUpdate(this.document, new Uint8Array(buffer));
          console.log(
            `[Document] Restored Y.js snapshot (${buffer.byteLength} bytes) for workspace: ${workspaceId}`,
          );
          return;
        }
        console.warn(
          "[Document] Snapshot fetch failed, falling back to cell-by-cell:",
          res.status,
        );
      }
    } catch (error) {
      console.warn(
        "[Document] Snapshot load failed, falling back to cell-by-cell:",
        error,
      );
    }

    // Fallback: reconstruct from individual cell records
    try {
      const cells = await client.query(anyApi.sync.getCells, {
        syncKey,
        workspaceId,
      });

      if (!cells || cells.length === 0) {
        console.log(
          "[Document] No cells in Convex for workspace:",
          workspaceId,
        );
        return;
      }

      console.log(
        `[Document] Reconstructing ${cells.length} cells from Convex for workspace: ${workspaceId}`,
      );

      const cellOrder = this.document.getArray<string>("cellOrder");
      const cellData = this.document.getMap<Y.Map<unknown>>("cellData");

      this.document.transact(() => {
        for (const cell of cells) {
          const cellMap = new Y.Map();
          cellMap.set("id", cell.yjsCellId);
          cellMap.set("type", cell.type);
          cellMap.set("authorType", cell.authorType);
          cellMap.set("authorId", cell.authorId);
          cellMap.set("status", cell.status);
          cellMap.set("createdAt", cell.createdAt);

          if (cell.agentRole) {
            cellMap.set("agentRole", cell.agentRole);
          }
          if (cell.language) {
            cellMap.set("language", cell.language);
          }

          // Integrate into doc first, then set Y.Text content
          cellData.set(cell.yjsCellId, cellMap);
          const integrated = cellData.get(cell.yjsCellId)!;
          const ytext = new Y.Text();
          ytext.insert(0, cell.content || "");
          integrated.set("content", ytext);

          cellOrder.push([cell.yjsCellId]);
        }
      });

      console.log(
        `[Document] Successfully reconstructed ${cells.length} cells from Convex`,
      );
    } catch (error) {
      console.error("[Document] Failed to load from Convex:", error);
    }
  }

  /**
   * Sync the Y.js document state to Convex.
   * Extracts cell metadata + content and calls the syncCells mutation.
   */
  private async syncToConvex() {
    const client = this.getConvexClient();
    if (!client) return;

    const workspaceId = this.getWorkspaceId();
    if (!workspaceId) {
      console.warn(
        "[Document] Could not parse workspaceId from room name:",
        this.name,
      );
      return;
    }

    const syncKey = this.env.INTERNAL_API_KEY;
    if (!syncKey) {
      console.warn(
        "[Document] INTERNAL_API_KEY not configured, skipping Convex sync",
      );
      return;
    }

    try {
      const cellOrder = this.document.getArray<string>("cellOrder");
      const cellDataMap = this.document.getMap<Y.Map<unknown>>("cellData");
      const orderedIds = cellOrder.toArray();

      const cells = orderedIds
        .map((cellId, index) => {
          const cell = cellDataMap.get(cellId);
          if (!cell) return null;

          const content = cell.get("content");
          const contentStr =
            content instanceof Y.Text
              ? content.toString()
              : String(content ?? "");

          return {
            yjsCellId: (cell.get("id") as string) || cellId,
            type: (cell.get("type") as string) || "note",
            content: contentStr,
            authorType: (cell.get("authorType") as string) || "human",
            authorId: (cell.get("authorId") as string) || "unknown",
            agentRole: cell.get("agentRole") as string | undefined,
            status: (cell.get("status") as string) || "active",
            language: cell.get("language") as string | undefined,
            orderIndex: index,
            createdAt: (cell.get("createdAt") as number) || Date.now(),
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      if (cells.length === 0) {
        console.log("[Document] No cells to sync for room:", this.name);
        return;
      }

      await client.mutation(anyApi.sync.syncCells, {
        syncKey,
        workspaceId,
        cells,
      });

      console.log(
        `[Document] Synced ${cells.length} cells to Convex for room: ${this.name}`,
      );

      // Upload the full Y.js state snapshot to Convex file storage
      await this.uploadSnapshot(client, syncKey, workspaceId);
    } catch (error) {
      console.error("[Document] Failed to sync to Convex:", error);
    }
  }

  /**
   * Upload the full Y.js document state as a binary snapshot to Convex file storage.
   * This enables fast, lossless document restoration (preserves CRDT history, undo stacks, etc.).
   */
  private async uploadSnapshot(
    client: ConvexHttpClient,
    syncKey: string,
    workspaceId: string,
  ) {
    try {
      // 1. Get an upload URL
      const uploadUrl = await client.mutation(
        anyApi.sync.generateSnapshotUploadUrl,
        { syncKey },
      );

      // 2. Encode and upload the Y.js state
      const stateUpdate = Y.encodeStateAsUpdate(this.document);
      const blob = new Blob([stateUpdate], {
        type: "application/octet-stream",
      });

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });

      if (!uploadRes.ok) {
        console.error("[Document] Snapshot upload failed:", uploadRes.status);
        return;
      }

      const { storageId } = (await uploadRes.json()) as { storageId: string };

      // 3. Save the storageId to the workspace (deletes the old snapshot)
      await client.mutation(anyApi.sync.saveSnapshot, {
        syncKey,
        workspaceId,
        storageId,
      });

      console.log(
        `[Document] Uploaded Y.js snapshot (${stateUpdate.byteLength} bytes) for room: ${this.name}`,
      );
    } catch (error) {
      // Non-fatal — cell data is already synced
      console.error("[Document] Failed to upload snapshot:", error);
    }
  }

  /**
   * Called periodically after edits and when the room empties
   * Persists the Y.Doc state to SQLite, then syncs to Convex
   */
  async onSave() {
    console.log(`[Document] onSave for room: ${this.name}`);

    const update = Y.encodeStateAsUpdate(this.document);

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO documents (id, content, updated_at)
       VALUES (?, ?, strftime('%s', 'now'))`,
      this.name,
      update,
    );

    // Flush any pending debounced sync immediately (room may be about to hibernate)
    const debouncedSync = this._debouncedSync;
    if (debouncedSync) {
      debouncedSync.flush();
    }
  }

  /**
   * Convert the notebook to markdown format for agent context
   */
  private toMarkdown(): string {
    const cellOrder = this.document.getArray<string>("cellOrder");
    const cellDataMap = this.document.getMap<Y.Map<unknown>>("cellData");
    const orderedIds = cellOrder.toArray();

    const sections: string[] = [];

    for (const cellId of orderedIds) {
      const cell = cellDataMap.get(cellId);
      if (!cell) continue;

      const type = cell.get("type") as string;
      const content = cell.get("content");
      const contentStr =
        content instanceof Y.Text ? content.toString() : String(content ?? "");
      const authorType = cell.get("authorType") as string;
      const agentRole = cell.get("agentRole") as string | undefined;

      if (!contentStr.trim()) continue;

      if (type === "code") {
        const language = (cell.get("language") as string) || "python";
        const authorLabel =
          authorType === "agent" && agentRole ? `[${agentRole}]` : "";
        sections.push(
          `\`\`\`${language} ${authorLabel}\n${contentStr}\n\`\`\``,
        );
      } else {
        if (authorType === "agent" && agentRole) {
          sections.push(`> **${agentRole}**: ${contentStr}`);
        } else {
          sections.push(contentStr);
        }
      }
    }

    return sections.join("\n\n");
  }

  /**
   * Handle HTTP requests to the Durable Object
   * POST: trigger a sync to Convex
   * GET: health check / sync status
   * GET /markdown: export notebook as markdown
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST") {
      try {
        await this.syncToConvex();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "GET") {
      if (url.pathname.endsWith("/markdown")) {
        const markdown = this.toMarkdown();
        return new Response(JSON.stringify({ ok: true, markdown }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const cellOrder = this.document.getArray<string>("cellOrder");
      return new Response(
        JSON.stringify({
          ok: true,
          room: this.name,
          cellCount: cellOrder.length,
          connections: [...this.getConnections()].length,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response("Method not allowed", { status: 405 });
  }

  /**
   * Handle custom messages from clients
   * Currently supports ping/pong for connection testing
   */
  onCustomMessage(connection: Connection, message: string): void {
    console.log(`[Document] Custom message from ${connection.id}:`, message);

    try {
      const data = JSON.parse(message);

      if (data.action === "ping") {
        this.sendCustomMessage(
          connection,
          JSON.stringify({ action: "pong", timestamp: Date.now() }),
        );
      }

      // Handle cell execution requests (future)
      if (data.action === "execute_cell") {
        // TODO: Forward to Modal for execution
        console.log(`[Document] Execute cell request:`, data.cellId);
      }
    } catch (error) {
      console.error("[Document] Failed to handle custom message:", error);
    }
  }

  /**
   * Called when a new connection is established
   */
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    console.log(`[Document] Connection established: ${connection.id}`);
    await super.onConnect(connection, ctx);
  }

  /**
   * Called when a connection is closed
   */
  onDisconnect(connection: Connection) {
    console.log(`[Document] Connection closed: ${connection.id}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
