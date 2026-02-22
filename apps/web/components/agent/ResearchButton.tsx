"use client";

import { useState, useRef } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Cancel01Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import { useAgentConnections } from "@/lib/use-agent-connections";

interface ResearchButtonProps {
  workspaceId: Id<"workspaces">;
  className?: string;
}

export function ResearchButton({
  workspaceId,
  className,
}: ResearchButtonProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [hypothesis, setHypothesis] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { hasActiveAgents, isConnected, startResearch, stopAll } =
    useAgentConnections(workspaceId);

  const handleSubmit = async () => {
    if (isStarting || hasActiveAgents || !hypothesis.trim()) return;

    setIsStarting(true);
    try {
      startResearch(hypothesis);
      setIsOpen(false);
      setHypothesis("");
    } catch (error) {
      console.error("Failed to start research:", error);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = () => {
    stopAll();
    setShowStopConfirm(false);
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
        disabled={isStarting || !isConnected}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
          hasActiveAgents
            ? "bg-amber-600 text-white hover:bg-amber-700"
            : "bg-violet-600 text-white hover:bg-violet-700",
          "disabled:opacity-50 disabled:pointer-events-none",
          className,
        )}
      >
        {isStarting ? (
          <>
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Starting...
          </>
        ) : hasActiveAgents ? (
          <>
            <div className="h-3 w-3 animate-pulse rounded-full bg-white/80" />
            Researching...
          </>
        ) : (
          <>
            <HugeiconsIcon icon={Search01Icon} size={14} />
            Research
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
                {typeof navigator !== "undefined" &&
                navigator.platform.includes("Mac")
                  ? "⌘"
                  : "Ctrl"}
                +Enter to submit
              </span>
              <button
                onClick={handleSubmit}
                disabled={!hypothesis.trim() || isStarting}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium",
                  "bg-violet-600 text-white hover:bg-violet-700",
                  "disabled:opacity-50 disabled:pointer-events-none transition-colors",
                )}
              >
                <HugeiconsIcon icon={Search01Icon} size={12} />
                Research
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
