"use client";

import { useRef, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons-pro/core-duotone-rounded";
import { Button } from "@/components/ui/button";
import { AgentActivityStream } from "./AgentActivityStream";
import { AgentChat } from "./AgentChat";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentRole } from "./types";
import { AGENT_ROLE_CONFIG, AGENT_STATUS_CONFIG } from "./types";

interface AgentDetailPanelProps {
  agentId: Id<"agents">;
  onClose?: () => void;
}

export function AgentDetailPanel({ agentId, onClose }: AgentDetailPanelProps) {
  const agent = useQuery(api.agents.get, { agentId });
  const activityContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activityContainerRef.current) {
      activityContainerRef.current.scrollTop =
        activityContainerRef.current.scrollHeight;
    }
  }, [agent]);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  const roleConfig = AGENT_ROLE_CONFIG[agent.role as AgentRole];
  const statusConfig = AGENT_STATUS_CONFIG[agent.status];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <AgentAvatar
            role={agent.role as AgentRole}
            status={agent.status}
            size={36}
          />
          <div>
            <h2 className="text-sm font-semibold">{roleConfig.label}</h2>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                  statusConfig.bgColor,
                  statusConfig.color,
                )}
              >
                {statusConfig.label}
              </span>
            </div>
          </div>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </Button>
        )}
      </header>

      <div ref={activityContainerRef} className="flex-1 overflow-y-auto">
        <AgentActivityStream agentId={agentId} />
      </div>

      <div className="border-t border-border">
        <AgentChat agentId={agentId} />
      </div>
    </div>
  );
}
