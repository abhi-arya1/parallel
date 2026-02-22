"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import { AgentStatusCard } from "./AgentStatusCard";
import type { Agent } from "./types";

interface AgentStatusSectionProps {
  workspaceId: Id<"workspaces">;
  selectedAgentId: Id<"agents"> | null;
  onSelectAgent: (agentId: Id<"agents"> | null) => void;
}

export function AgentStatusSection({
  workspaceId,
  selectedAgentId,
  onSelectAgent,
}: AgentStatusSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const agents = useQuery(api.agents.listByWorkspace, { workspaceId });

  const hasActiveAgents = agents?.some((a) =>
    ["spawning", "thinking", "working", "awaiting_approval"].includes(a.status),
  );

  if (!agents || agents.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center justify-between px-4 py-2 text-sm font-medium",
          "hover:bg-accent/50 transition-colors",
        )}
      >
        <div className="flex items-center gap-2">
          <span>Agents</span>
          {hasActiveAgents && (
            <span className="flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
        </div>
        <HugeiconsIcon
          icon={isExpanded ? ArrowUp01Icon : ArrowDown01Icon}
          size={14}
          className="text-muted-foreground"
        />
      </button>

      {isExpanded && (
        <div className="px-2 pb-2 space-y-1">
          {agents.map((agent) => (
            <AgentStatusCard
              key={agent._id}
              agent={agent as Agent}
              isSelected={selectedAgentId === agent._id}
              onClick={() =>
                onSelectAgent(selectedAgentId === agent._id ? null : agent._id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
