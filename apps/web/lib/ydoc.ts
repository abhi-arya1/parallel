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
 * Get cell content (Y.XmlFragment for rich text, Y.Text for code)
 */
export function getCellContent(
  cell: Y.Map<unknown>,
): Y.XmlFragment | Y.Text | undefined {
  return cell.get("content") as Y.XmlFragment | Y.Text | undefined;
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
}

/**
 * Create a new cell and add it to the document
 * @param ydoc The Y.Doc instance
 * @param options Cell creation options
 * @param afterCellId Optional cell ID to insert after (appends to end if not provided)
 * @returns The new cell's ID
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

    // Create appropriate content type
    if (options.type === "code") {
      cellMap.set("content", new Y.Text());
      cellMap.set("language", options.language ?? "python");
    } else {
      cellMap.set("content", new Y.XmlFragment());
    }

    // Add to cell data map
    cellData.set(cellId, cellMap);

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
 * Update a cell's type
 */
export function updateCellType(
  ydoc: Y.Doc,
  cellId: string,
  type: CellType,
): void {
  const cell = getCell(ydoc, cellId);
  if (!cell) return;

  const currentType = cell.get("type") as CellType;
  const isCurrentlyCode = currentType === "code";
  const willBeCode = type === "code";

  ydoc.transact(() => {
    cell.set("type", type);

    // If switching between code and non-code, we need to change content type
    // This is a destructive operation - content will be lost
    if (isCurrentlyCode !== willBeCode) {
      if (willBeCode) {
        cell.set("content", new Y.Text());
        cell.set("language", "python");
      } else {
        cell.set("content", new Y.XmlFragment());
        cell.delete("language");
      }
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
