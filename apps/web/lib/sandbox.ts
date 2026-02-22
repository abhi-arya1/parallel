/**
 * Sandbox/Kernel API client for executing code cells on Modal
 */

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "http://localhost:8000";

export interface CellOutput {
  cell_id: string;
  yjs_cell_id: string;
  type: "stdout" | "stderr" | "image" | "dataframe" | "error" | "result";
  content: string;
}

export interface ExecuteResponse {
  success: boolean;
  outputs: CellOutput[];
  error?: string;
}

export interface KernelStatus {
  workspace_id: string;
  sandbox_id: string | null;
  status: "running" | "stopped" | "not_found";
  gpu: string | null;
}

export interface StartKernelResponse {
  success: boolean;
  sandbox_id: string | null;
  error?: string;
}

/**
 * Get the kernel status for a workspace
 */
export async function getKernelStatus(
  workspaceId: string,
): Promise<KernelStatus> {
  const response = await fetch(`${SANDBOX_URL}/kernel/${workspaceId}/status`);
  if (!response.ok) {
    throw new Error(`Failed to get kernel status: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Start or restart a kernel for a workspace
 */
export async function startKernel(
  workspaceId: string,
  gpu?: string,
): Promise<StartKernelResponse> {
  const response = await fetch(`${SANDBOX_URL}/kernel/${workspaceId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId, gpu }),
  });
  if (!response.ok) {
    return {
      success: false,
      sandbox_id: null,
      error: `Failed to start kernel: ${response.statusText}`,
    };
  }
  return response.json();
}

/**
 * Stop a workspace's kernel
 */
export async function stopKernel(
  workspaceId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`${SANDBOX_URL}/kernel/${workspaceId}/stop`, {
    method: "POST",
  });
  if (!response.ok) {
    return { success: false };
  }
  return response.json();
}

/**
 * Restart a workspace's kernel (clears all state)
 */
export async function restartKernel(
  workspaceId: string,
): Promise<StartKernelResponse> {
  const response = await fetch(`${SANDBOX_URL}/kernel/${workspaceId}/restart`, {
    method: "POST",
  });
  if (!response.ok) {
    return {
      success: false,
      sandbox_id: null,
      error: `Failed to restart kernel: ${response.statusText}`,
    };
  }
  return response.json();
}

/**
 * Execute a single cell
 * The kernel maintains state, so variables persist between executions
 */
export async function executeCell(
  workspaceId: string,
  cellId: string,
): Promise<ExecuteResponse> {
  const response = await fetch(
    `${SANDBOX_URL}/execute/${workspaceId}/${cellId}`,
    { method: "POST" },
  );

  if (!response.ok) {
    const error = await response.text();
    return {
      success: false,
      outputs: [],
      error: `Sandbox error: ${error}`,
    };
  }

  return response.json();
}

/**
 * Execute all cells in order (or specific cells)
 */
export async function executeCells(
  workspaceId: string,
  cellId?: string,
): Promise<ExecuteResponse> {
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      cell_id: cellId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return {
      success: false,
      outputs: [],
      error: `Sandbox error: ${error}`,
    };
  }

  return response.json();
}

/**
 * NDJSON Event types from streaming execution
 */
export interface StreamEvent {
  type: "stdout" | "stderr" | "image" | "result" | "error" | "done";
  data?: string;
  message?: string;
  content?: string;
  format?: "text" | "dataframe";
}

/**
 * Callbacks for streaming execution events
 */
export interface StreamCallbacks {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onImage?: (dataUrl: string) => void;
  onResult?: (result: { type: string; content: string }) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

/**
 * Execute a cell with streaming output via NDJSON
 * Real-time output for print statements, loops with delays, etc.
 *
 * Uses fetch + ReadableStream for robust streaming instead of EventSource.
 */
export async function executeCellStreaming(
  workspaceId: string,
  cellId: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const url = `${SANDBOX_URL}/stream/${workspaceId}/${cellId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/x-ndjson",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const error = await response.text();
      callbacks.onError?.(`Execution failed: ${error}`);
      callbacks.onDone?.();
      return;
    }

    if (!response.body) {
      callbacks.onError?.("No response body");
      callbacks.onDone?.();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (buffer.trim()) {
          processLine(buffer, callbacks);
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line, callbacks);
      }
    }

    reader.releaseLock();
  } catch (error) {
    callbacks.onError?.(
      `Stream error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    callbacks.onDone?.();
  }
}

/**
 * Process a single NDJSON line and call appropriate callback
 */
function processLine(line: string, callbacks: StreamCallbacks): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const event = JSON.parse(trimmed) as StreamEvent;

    switch (event.type) {
      case "stdout":
        if (event.data) {
          callbacks.onStdout?.(event.data);
        }
        break;

      case "stderr":
        if (event.data) {
          callbacks.onStderr?.(event.data);
        }
        break;

      case "image":
        if (event.data) {
          callbacks.onImage?.(event.data);
        }
        break;

      case "result":
        if (event.content) {
          const resultType =
            event.format === "dataframe" ? "dataframe" : "result";
          callbacks.onResult?.({ type: resultType, content: event.content });
        }
        break;

      case "error":
        if (event.message) {
          callbacks.onError?.(event.message);
        }
        break;

      case "done":
        // Done is handled by the stream ending
        break;
    }
  } catch {
    // Non-JSON output - treat as stdout
    callbacks.onStdout?.(trimmed + "\n");
  }
}
