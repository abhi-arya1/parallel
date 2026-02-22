"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AGENT_ROLE_INFO } from "@/types/cells";

interface RunsPanelProps {
  workspaceId: Id<"workspaces">;
}

type RunStatus = "live" | "done" | "failed";

interface MetricPoint {
  step: number;
  key: string;
  value: number;
  timestamp: number;
}

interface Run {
  _id: Id<"runs">;
  name: string;
  status: RunStatus;
  agentRole?: keyof typeof AGENT_ROLE_INFO;
  metrics: MetricPoint[];
  createdAt: number;
  completedAt?: number;
}

/**
 * Simple sparkline component for displaying metric trends
 */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const height = 20;
  const width = 60;

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  });

  const lastValue = data[data.length - 1] ?? 0;
  const lastY = height - ((lastValue - min) / range) * height;

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End point indicator */}
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

/**
 * Status indicator with color and optional pulse animation
 */
function StatusBadge({ status }: { status: RunStatus }) {
  const config = {
    live: {
      color: "bg-green-500",
      text: "Live",
      pulse: true,
    },
    done: {
      color: "bg-blue-500",
      text: "Done",
      pulse: false,
    },
    failed: {
      color: "bg-red-500",
      text: "Failed",
      pulse: false,
    },
  };

  const { color, text, pulse } = config[status];

  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
      />
      {text}
    </span>
  );
}

/**
 * Individual run card showing name, status, and metrics
 */
function RunCard({ run }: { run: Run }) {
  // Group metrics by key and get latest values
  const metricsByKey = run.metrics.reduce(
    (acc, m) => {
      if (!acc[m.key]) acc[m.key] = [];
      acc[m.key]!.push(m.value);
      return acc;
    },
    {} as Record<string, number[]>,
  );

  const agentInfo = run.agentRole ? AGENT_ROLE_INFO[run.agentRole] : null;
  const timeSince = getTimeSince(run.createdAt);

  return (
    <div className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/30">
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium">{run.name}</h4>
          {agentInfo && (
            <span className="text-xs" style={{ color: agentInfo.color }}>
              {agentInfo.label}
            </span>
          )}
        </div>
        <StatusBadge status={run.status} />
      </div>

      {/* Metrics */}
      {Object.keys(metricsByKey).length > 0 && (
        <div className="space-y-1.5">
          {Object.entries(metricsByKey)
            .slice(0, 3) // Show max 3 metrics
            .map(([key, values]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{key}</span>
                <div className="flex items-center gap-2">
                  <Sparkline
                    data={values}
                    color={run.status === "live" ? "#22c55e" : "#60a5fa"}
                  />
                  <span className="min-w-[40px] text-right text-xs font-mono">
                    {values[values.length - 1]?.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{timeSince}</span>
        {run.completedAt && (
          <span>{formatDuration(run.completedAt - run.createdAt)}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Get human-readable time since a timestamp
 */
function getTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * RunsPanel - displays active and recent experiment runs
 */
export function RunsPanel({ workspaceId }: RunsPanelProps) {
  const runs = useQuery(api.runs.list, { workspaceId }) as Run[] | undefined;

  if (!runs) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  const liveRuns = runs.filter((r) => r.status === "live");
  const completedRuns = runs.filter((r) => r.status !== "live");

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Active count badge */}
      {liveRuns.length > 0 && (
        <div className="flex items-center justify-end">
          <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
            {liveRuns.length} active
          </span>
        </div>
      )}

      {/* Empty state */}
      {runs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <p className="text-sm text-muted-foreground">No runs yet</p>
        </div>
      )}

      {/* Live runs */}
      {liveRuns.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Active
          </h4>
          {liveRuns.map((run) => (
            <RunCard key={run._id} run={run} />
          ))}
        </div>
      )}

      {/* Completed runs */}
      {completedRuns.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent
          </h4>
          {completedRuns.slice(0, 5).map((run) => (
            <RunCard key={run._id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
