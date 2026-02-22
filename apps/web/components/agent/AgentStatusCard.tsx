"use client";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentRole, AgentStatus } from "./types";
import { AGENT_ROLE_CONFIG, AGENT_STATUS_CONFIG } from "./types";

interface AgentStatusCardProps {
  role: AgentRole;
  status: AgentStatus;
  isSelected: boolean;
  onClick: () => void;
}

export function AgentStatusCard({
  role,
  status,
  isSelected,
  onClick,
}: AgentStatusCardProps) {
  const roleConfig = AGENT_ROLE_CONFIG[role];
  const statusConfig = AGENT_STATUS_CONFIG[status];
  const isActive = ["thinking", "working", "awaiting_approval"].includes(
    status,
  );

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
        <AgentAvatar role={role} status={status} size={28} />
        {isActive && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span
              className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                status === "awaiting_approval"
                  ? "bg-orange-400"
                  : "bg-blue-400",
              )}
            />
            <span
              className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                status === "awaiting_approval"
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
          {statusConfig.showLabel && statusConfig.label && (
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
      </div>
    </button>
  );
}
