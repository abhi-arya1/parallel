"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Delete02Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import { Button } from "@/components/ui/button";
import { AgentActivityStream } from "./AgentActivityStream";
import { AgentChat } from "./AgentChat";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentRole, AgentStatus, Activity } from "./types";
import { AGENT_ROLE_CONFIG, AGENT_STATUS_CONFIG } from "./types";

interface AgentDetailPanelProps {
  role: AgentRole;
  status: AgentStatus;
  autoApprove: boolean;
  activity: Activity[];
  streamingText?: string;
  onSteer: (content: string) => void;
  onClear: () => void;
  onSetAutoApprove: (value: boolean) => void;
  onClose?: () => void;
}

export function AgentDetailPanel({
  role,
  status,
  autoApprove,
  activity,
  streamingText,
  onSteer,
  onClear,
  onSetAutoApprove,
  onClose,
}: AgentDetailPanelProps) {
  const activityContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activityContainerRef.current) {
      activityContainerRef.current.scrollTop =
        activityContainerRef.current.scrollHeight;
    }
  }, [activity, streamingText]);

  const roleConfig = AGENT_ROLE_CONFIG[role];
  const statusConfig = AGENT_STATUS_CONFIG[status];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <AgentAvatar role={role} status={status} size={36} />
          <div>
            <h2 className="text-sm font-semibold">{roleConfig.label}</h2>
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSetAutoApprove(!autoApprove)}
            className={cn(
              "flex items-center gap-1.5 h-6 px-2 rounded-full text-[10px] font-medium transition-colors",
              autoApprove
                ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                : "bg-muted text-muted-foreground border border-transparent hover:border-border",
            )}
          >
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                autoApprove ? "bg-emerald-500" : "bg-muted-foreground/50",
              )}
            />
            {autoApprove ? "Auto-approve on" : "Auto-approve off"}
          </button>
          <Button variant="ghost" size="icon-xs" onClick={onClear}>
            <HugeiconsIcon icon={Delete02Icon} size={14} />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon-xs" onClick={onClose}>
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </Button>
          )}
        </div>
      </header>

      <div ref={activityContainerRef} className="flex-1 overflow-y-auto">
        <AgentActivityStream
          activity={activity}
          streamingText={streamingText}
        />
      </div>

      <div className="border-t border-border">
        <AgentChat role={role} status={status} onSteer={onSteer} />
      </div>
    </div>
  );
}
