"use client";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "./AgentAvatar";
import type { Agent, AgentRole } from "./types";
import { AGENT_ROLE_CONFIG, AGENT_STATUS_CONFIG } from "./types";

interface AgentStatusCardProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

export function AgentStatusCard({
  agent,
  isSelected,
  onClick,
}: AgentStatusCardProps) {
  const roleConfig = AGENT_ROLE_CONFIG[agent.role];
  const statusConfig = AGENT_STATUS_CONFIG[agent.status];
  const isActive = [
    "thinking",
    "working",
    "working_hard",
    "awaiting_approval",
  ].includes(agent.status);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors",
        "hover:bg-accent/50",
        isSelected && "bg-accent",
      )}
    >
      <div className="relative flex-shrink-0">
        <AgentAvatar
          role={agent.role as AgentRole}
          status={agent.status}
          size={28}
        />
        {isActive && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span
              className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                agent.status === "awaiting_approval"
                  ? "bg-orange-400"
                  : "bg-blue-400",
              )}
            />
            <span
              className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                agent.status === "awaiting_approval"
                  ? "bg-orange-500"
                  : "bg-blue-500",
              )}
            />
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">
            {roleConfig.label}
          </span>
          {statusConfig.label && (
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                statusConfig.bgColor,
                statusConfig.color,
              )}
            >
              {statusConfig.label}
            </span>
          )}
        </div>
        {agent.error ? (
          <p className="text-xs text-red-500 truncate mt-0.5">
            {(() => {
              try {
                const parsed = JSON.parse(agent.error);
                return parsed.message ?? agent.error;
              } catch {
                return agent.error;
              }
            })()}
          </p>
        ) : agent.currentTask ? (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {agent.currentTask}
          </p>
        ) : null}
      </div>
    </button>
  );
}
