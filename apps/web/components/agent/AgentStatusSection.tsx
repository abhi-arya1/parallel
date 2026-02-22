"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import { AgentStatusCard } from "./AgentStatusCard";
import type { AgentRole, AgentState } from "./types";

const ALL_ROLES: AgentRole[] = ["engineer", "researcher", "reviewer"];

interface AgentStatusSectionProps {
  agents: Record<AgentRole, AgentState>;
  selectedAgentRole: AgentRole | null;
  onSelectAgent: (role: AgentRole | null) => void;
}

export function AgentStatusSection({
  agents,
  selectedAgentRole,
  onSelectAgent,
}: AgentStatusSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const hasActiveAgents = ALL_ROLES.some((role) =>
    ["spawning", "thinking", "working", "awaiting_approval"].includes(
      agents[role].status,
    ),
  );

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
          {ALL_ROLES.map((role) => (
            <AgentStatusCard
              key={role}
              role={role}
              status={agents[role].status}
              isSelected={selectedAgentRole === role}
              onClick={() =>
                onSelectAgent(selectedAgentRole === role ? null : role)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
