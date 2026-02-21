/**
 * Sandbox API client for executing code cells on Modal
 */

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "http://localhost:8000";

export interface ExecuteRequest {
  workspace_id: string;
  cell_id?: string; // If provided, executes all cells up to and including this one
}

export interface CellOutput {
  cell_id: string;
  yjs_cell_id: string;
  type: "stdout" | "stderr" | "image" | "dataframe" | "error";
  content: string;
}

export interface ExecuteResponse {
  success: boolean;
  outputs: CellOutput[];
  error?: string;
}

/**
 * Execute code cells for a workspace
 * @param workspaceId - The workspace ID
 * @param cellId - Optional cell ID to execute up to (if not provided, executes all cells)
 */
export async function executeCell(
  workspaceId: string,
  cellId?: string,
): Promise<ExecuteResponse> {
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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
 * Execute a single cell (runs all cells up to and including this one)
 */
export async function executeSingleCell(
  workspaceId: string,
  cellId: string,
): Promise<ExecuteResponse> {
  const response = await fetch(
    `${SANDBOX_URL}/execute/${workspaceId}/${cellId}`,
    {
      method: "POST",
    },
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
