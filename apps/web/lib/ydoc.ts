import * as Y from "yjs";
import { nanoid } from "nanoid";
import type {
  CellType,
  CellStatus,
  AuthorType,
  AgentRole,
} from "@/types/cells";

// Y.Doc field names
export const CELL_ORDER_KEY = "cellOrder";
export const CELL_DATA_KEY = "cellData";

/**
 * Initialize a new Y.Doc with the standard structure for a workspace
 */
export function createYDoc(): Y.Doc {
  return new Y.Doc();
}

/**
 * Get the cell order array from a Y.Doc
 */
export function getCellOrder(ydoc: Y.Doc): Y.Array<string> {
  return ydoc.getArray<string>(CELL_ORDER_KEY);
}

/**
 * Get the cell data map from a Y.Doc
 */
export function getCellData(ydoc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return ydoc.getMap<Y.Map<unknown>>(CELL_DATA_KEY);
}

/**
 * Get a specific cell's Y.Map from the document
 */
export function getCell(
  ydoc: Y.Doc,
  cellId: string,
): Y.Map<unknown> | undefined {
  const cellData = getCellData(ydoc);
  return cellData.get(cellId);
}

/**
 * Get cell content (always Y.Text)
 */
export function getCellContent(cell: Y.Map<unknown>): Y.Text | undefined {
  return cell.get("content") as Y.Text | undefined;
}

/**
 * Get cell metadata fields
 */
export function getCellMetadata(cell: Y.Map<unknown>) {
  return {
    id: cell.get("id") as string,
    type: cell.get("type") as CellType,
    authorType: cell.get("authorType") as AuthorType,
    authorId: cell.get("authorId") as string,
    agentRole: cell.get("agentRole") as AgentRole | undefined,
    status: cell.get("status") as CellStatus,
    createdAt: cell.get("createdAt") as number,
    language: cell.get("language") as string | undefined,
  };
}

interface CreateCellOptions {
  type: CellType;
  authorType: AuthorType;
  authorId: string;
  agentRole?: AgentRole;
  status?: CellStatus;
  language?: string;
  initialContent?: string;
}

/**
 * Create a new cell and add it to the document.
 * Content (Y.Text) is set AFTER the cell map is integrated into the doc
 * to avoid operating on non-integrated Y types.
 */
export function createCell(
  ydoc: Y.Doc,
  options: CreateCellOptions,
  afterCellId?: string,
): string {
  const cellId = nanoid();
  const cellOrder = getCellOrder(ydoc);
  const cellData = getCellData(ydoc);

  ydoc.transact(() => {
    // Create the cell's Y.Map
    const cellMap = new Y.Map();
    cellMap.set("id", cellId);
    cellMap.set("type", options.type);
    cellMap.set("authorType", options.authorType);
    cellMap.set("authorId", options.authorId);
    cellMap.set("status", options.status ?? "active");
    cellMap.set("createdAt", Date.now());

    if (options.agentRole) {
      cellMap.set("agentRole", options.agentRole);
    }

    if (options.type === "code") {
      cellMap.set("language", options.language ?? "python");
    }

    // Integrate into the doc first
    cellData.set(cellId, cellMap);

    // Now set Y.Text content on the integrated map
    const integrated = cellData.get(cellId)!;
    const ytext = new Y.Text();
    if (options.initialContent) {
      ytext.insert(0, options.initialContent);
    }
    integrated.set("content", ytext);

    // Add to cell order array
    if (afterCellId) {
      const index = cellOrder.toArray().indexOf(afterCellId);
      if (index !== -1) {
        cellOrder.insert(index + 1, [cellId]);
      } else {
        cellOrder.push([cellId]);
      }
    } else {
      cellOrder.push([cellId]);
    }
  });

  return cellId;
}

/**
 * Delete a cell from the document
 */
export function deleteCell(ydoc: Y.Doc, cellId: string): void {
  const cellOrder = getCellOrder(ydoc);
  const cellData = getCellData(ydoc);

  ydoc.transact(() => {
    // Remove from cell order
    const index = cellOrder.toArray().indexOf(cellId);
    if (index !== -1) {
      cellOrder.delete(index, 1);
    }

    // Remove from cell data
    cellData.delete(cellId);
  });
}

/**
 * Update a cell's status
 */
export function updateCellStatus(
  ydoc: Y.Doc,
  cellId: string,
  status: CellStatus,
): void {
  const cell = getCell(ydoc, cellId);
  if (cell) {
    cell.set("status", status);
  }
}

/**
 * Update a cell's type (content stays as Y.Text, only metadata changes)
 */
export function updateCellType(
  ydoc: Y.Doc,
  cellId: string,
  type: CellType,
): void {
  const cell = getCell(ydoc, cellId);
  if (!cell) return;

  ydoc.transact(() => {
    cell.set("type", type);

    if (type === "code") {
      cell.set("language", "python");
    } else {
      cell.delete("language");
    }
  });
}

/**
 * Move a cell to a new position
 */
export function moveCell(
  ydoc: Y.Doc,
  cellId: string,
  afterCellId: string | null,
): void {
  const cellOrder = getCellOrder(ydoc);
  const cells = cellOrder.toArray();
  const currentIndex = cells.indexOf(cellId);

  if (currentIndex === -1) return;

  ydoc.transact(() => {
    // Remove from current position
    cellOrder.delete(currentIndex, 1);

    // Insert at new position
    if (afterCellId === null) {
      // Move to beginning
      cellOrder.insert(0, [cellId]);
    } else {
      const targetIndex = cellOrder.toArray().indexOf(afterCellId);
      if (targetIndex !== -1) {
        cellOrder.insert(targetIndex + 1, [cellId]);
      } else {
        cellOrder.push([cellId]);
      }
    }
  });
}

/**
 * Get all cell IDs in order
 */
export function getCellIds(ydoc: Y.Doc): string[] {
  return getCellOrder(ydoc).toArray();
}

/**
 * Check if a cell exists
 */
export function cellExists(ydoc: Y.Doc, cellId: string): boolean {
  return getCellData(ydoc).has(cellId);
}

/**
 * Export the notebook to markdown format
 */
export function exportToMarkdown(ydoc: Y.Doc): string {
  const cellOrder = getCellOrder(ydoc);
  const cellData = getCellData(ydoc);
  const cellIds = cellOrder.toArray();

  const parts: string[] = [];

  for (const cellId of cellIds) {
    const cell = cellData.get(cellId);
    if (!cell) continue;

    const type = cell.get("type") as CellType;
    const content = cell.get("content") as Y.Text | undefined;
    const text = content?.toString() ?? "";

    if (type === "markdown") {
      parts.push(text);
    } else if (type === "code") {
      const language = (cell.get("language") as string) ?? "python";
      parts.push(`\`\`\`${language}\n${text}\n\`\`\``);
    }
  }

  return parts.join("\n\n");
}
