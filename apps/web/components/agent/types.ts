import type { Id } from "@/convex/_generated/dataModel";

export type AgentRole = "engineer" | "researcher" | "reviewer";

export type AgentStatus =
  | "spawning"
  | "thinking"
  | "working"
  | "awaiting_approval"
  | "done"
  | "idle"
  | "error";

export interface Agent {
  _id: Id<"agents">;
  workspaceId: Id<"workspaces">;
  role: AgentRole;
  status: AgentStatus;
  currentTask?: string;
  findings: Id<"cells">[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
  pendingAction?: "execute_code" | "publish_finding";
  pendingCode?: string;
  autoApprove?: boolean;
}

export interface ActivityItem {
  _id: Id<"activity_stream">;
  workspaceId: Id<"workspaces">;
  agentId?: Id<"agents">;
  agentRole?: string;
  contentType: string;
  content: unknown;
  timestamp: number;
  streamId?: string;
  isPartial?: boolean;
}

export interface AgentMessage {
  _id: Id<"agent_messages">;
  workspaceId: Id<"workspaces">;
  agentId: Id<"agents">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export const AGENT_ROLE_CONFIG: Record<
  AgentRole,
  { label: string; description: string; color: string }
> = {
  engineer: {
    label: "Engineer",
    description: "Designs and runs experiments",
    color: "text-blue-500",
  },
  researcher: {
    label: "Researcher",
    description: "Finds relevant literature",
    color: "text-emerald-500",
  },
  reviewer: {
    label: "Reviewer",
    description: "Plays devil's advocate",
    color: "text-purple-500",
  },
};

export const AGENT_STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; bgColor: string }
> = {
  spawning: {
    label: "Starting",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
  thinking: {
    label: "Thinking",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  working: {
    label: "Working",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  awaiting_approval: {
    label: "Needs Approval",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
  },
  done: {
    label: "Done",
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
  },
  idle: {
    label: "Idle",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
  error: {
    label: "Error",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
  },
};
