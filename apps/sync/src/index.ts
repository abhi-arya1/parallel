import { routePartykitRequest, Server } from "partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import type { CallbackOptions } from "y-partyserver";

/**
 * Document Durable Object for Y.js collaboration
 *
 * Each workspace gets its own Document instance that:
 * 1. Maintains the Y.Doc in memory
 * 2. Persists to SQLite on the Durable Object
 * 3. Syncs cell snapshots to Convex on save (TODO)
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
   * Retrieves the Y.Doc state from SQLite
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
    }
  }

  /**
   * Called periodically after edits and when the room empties
   * Persists the Y.Doc state to SQLite
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

    // TODO: Sync cell snapshots to Convex via HTTP
    // This would extract cell data from the Y.Doc and POST to Convex
    // await this.syncToConvex();
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

  // Future: Sync to Convex
  // private async syncToConvex() {
  //   const convexUrl = env.CONVEX_HTTP_URL;
  //   if (!convexUrl) return;
  //
  //   const cellOrder = this.document.getArray('cellOrder').toArray();
  //   const cellData = this.document.getMap('cellData');
  //
  //   // Extract cell metadata and content for Convex
  //   const cells = cellOrder.map(cellId => {
  //     const cell = cellData.get(cellId);
  //     // ... extract data
  //   });
  //
  //   await fetch(`${convexUrl}/sync/cells`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ workspaceId: this.name, cells }),
  //   });
  // }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
