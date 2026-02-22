import type { Id } from "@/convex/_generated/dataModel";

// Cell types supported in the notebook
export type CellType = "markdown" | "code";

// Agent roles (matches existing Convex schema)
export type AgentRole = "engineer" | "researcher" | "reviewer";

// Author type
export type AuthorType = "human" | "agent";

// Cell status
export type CellStatus = "active" | "promoted" | "pruned" | "pending";

// Cell metadata stored in Y.js Map
export interface CellMetadata {
  id: string;
  type: CellType;
  authorType: AuthorType;
  authorId: string;
  agentRole?: AgentRole;
  status: CellStatus;
  createdAt: number;
  language?: string; // For code cells: 'python' | 'javascript' | 'r'
}

// Agent role → visual color mapping
export const AGENT_COLORS: Record<AgentRole, string> = {
  engineer: "#4ECDC4", // teal
  researcher: "#A8DADC", // light blue
  reviewer: "#FF6B6B", // coral
};

// Agent role display names
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  engineer: "Engineer",
  researcher: "Researcher",
  reviewer: "Reviewer",
};

// Combined agent role info for display
export const AGENT_ROLE_INFO: Record<
  AgentRole,
  { label: string; color: string }
> = {
  engineer: { label: "Engineer", color: "#4ECDC4" },
  researcher: { label: "Researcher", color: "#A8DADC" },
  reviewer: { label: "Reviewer", color: "#FF6B6B" },
};

// Cell type display info
export const CELL_TYPE_INFO: Record<
  CellType,
  { label: string; placeholder: string }
> = {
  markdown: {
    label: "Markdown",
    placeholder: "Write your notes...",
  },
  code: {
    label: "Code",
    placeholder: "# Write your code here",
  },
};

// Code cell output types
export type OutputType = "stdout" | "stderr" | "image" | "dataframe" | "error";

export interface CellOutput {
  type: OutputType;
  content: string; // text, base64 image, or JSON for dataframe
  timestamp: number;
}

// Thread message for cell discussions
export interface ThreadMessage {
  id: string;
  cellId: string;
  authorName: string;
  authorType: AuthorType;
  agentRole?: AgentRole;
  content: string;
  createdAt: number;
  parentThreadId?: string;
}

// Run tracking for experiments
export interface Run {
  id: string;
  cellId: string;
  agentRole?: AgentRole;
  config: Record<string, unknown>;
  status: "live" | "done" | "failed";
  metrics: MetricPoint[];
  createdAt: number;
}

export interface MetricPoint {
  step: number;
  key: string;
  value: number;
}

// Presence/awareness user info
export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
  email?: string;
  image?: string;
}

// Supported code languages
export const CODE_LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "r", label: "R" },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];
