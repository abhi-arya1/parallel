"use client";

import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Idea01Icon, Cancel01Icon } from "@hugeicons-pro/core-duotone-rounded";
import { triggerHypothesisWorkflow, type AgentRole } from "@/lib/agents";

interface ThinkButtonProps {
  workspaceId: Id<"workspaces">;
  className?: string;
}

const ALL_ROLES: AgentRole[] = ["engineer", "researcher", "reviewer"];

export function ThinkButton({ workspaceId, className }: ThinkButtonProps) {
  const [isSpawning, setIsSpawning] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [hypothesis, setHypothesis] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const spawnAgents = useMutation(api.agents.spawnAgents);
  const stopAllAgents = useMutation(api.agents.stopAllAgents);
  const existingAgents = useQuery(api.agents.listByWorkspace, { workspaceId });

  const hasActiveAgents = existingAgents?.some((a) =>
    [
      "spawning",
      "thinking",
      "working",
      "working_hard",
      "awaiting_approval",
    ].includes(a.status),
  );

  const handleSubmit = async () => {
    if (isSpawning || hasActiveAgents || !hypothesis.trim()) return;

    setIsSpawning(true);
    try {
      const result = await spawnAgents({
        workspaceId,
        roles: ALL_ROLES,
      });

      const agentIds = result as Record<AgentRole, string>;
      await triggerHypothesisWorkflow(workspaceId, hypothesis, agentIds);
      setIsOpen(false);
      setHypothesis("");
    } catch (error) {
      console.error("Failed to spawn agents:", error);
    } finally {
      setIsSpawning(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopAllAgents({ workspaceId });
      setShowStopConfirm(false);
    } catch (error) {
      console.error("Failed to stop agents:", error);
    }
  };

  const handleButtonClick = () => {
    if (hasActiveAgents) {
      setShowStopConfirm(!showStopConfirm);
      setIsOpen(false);
    } else {
      setIsOpen(!isOpen);
      setShowStopConfirm(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setIsOpen(false);
      setShowStopConfirm(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleButtonClick}
        disabled={isSpawning}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
          hasActiveAgents
            ? "bg-amber-600 text-white hover:bg-amber-700"
            : "bg-violet-600 text-white hover:bg-violet-700",
          "disabled:opacity-50 disabled:pointer-events-none",
          className,
        )}
      >
        {isSpawning ? (
          <>
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Starting...
          </>
        ) : hasActiveAgents ? (
          <>
            <div className="h-3 w-3 animate-pulse rounded-full bg-white/80" />
            Thinking...
          </>
        ) : (
          <>
            <HugeiconsIcon icon={Idea01Icon} size={14} />
            Think
          </>
        )}
      </button>

      {showStopConfirm && hasActiveAgents && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowStopConfirm(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg">
            <p className="text-sm font-medium mb-2">Stop all agents?</p>
            <p className="text-xs text-muted-foreground mb-3">
              This will cancel all running analysis. You can start again later.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowStopConfirm(false)}
                className="flex-1 h-7 px-3 rounded-md text-xs font-medium border border-input bg-background hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStop}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
                Stop
              </button>
            </div>
          </div>
        </>
      )}

      {isOpen && !hasActiveAgents && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg">
            <label className="text-xs font-medium text-muted-foreground mb-2 block">
              What would you like to explore?
            </label>
            <textarea
              ref={inputRef}
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a hypothesis or question..."
              rows={3}
              autoFocus
              className={cn(
                "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-muted-foreground">
                {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to
                submit
              </span>
              <button
                onClick={handleSubmit}
                disabled={!hypothesis.trim() || isSpawning}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium",
                  "bg-violet-600 text-white hover:bg-violet-700",
                  "disabled:opacity-50 disabled:pointer-events-none transition-colors",
                )}
              >
                <HugeiconsIcon icon={Idea01Icon} size={12} />
                Analyze
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
