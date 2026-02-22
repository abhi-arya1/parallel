"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";

const AGENTS_URL =
  process.env.NEXT_PUBLIC_AGENTS_URL || "http://localhost:8787";

export type AgentRole = "engineer" | "researcher" | "reviewer";
export type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "awaiting_approval"
  | "done"
  | "error";

export interface Activity {
  id: string;
  type: string;
  content: unknown;
  streamId?: string;
  isPartial?: boolean;
  createdAt: number;
}

export interface Finding {
  id: string;
  content: string;
  cellType: string;
  createdAt: number;
  syncedToNotebook: boolean;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  autoApprove: boolean;
  activity: Activity[];
  findings: Finding[];
  messages: Message[];
  streamingText?: string;
  streamId?: string;
  pendingCode?: string;
  connected: boolean;
}

type ServerMessage =
  | {
      type: "state";
      role: AgentRole;
      status: AgentStatus;
      autoApprove: boolean;
      activity: Activity[];
      findings: Finding[];
      messages: Message[];
    }
  | { type: "status"; role: AgentRole; status: AgentStatus }
  | { type: "text-delta"; role: AgentRole; text: string; streamId: string }
  | { type: "tool-call"; role: AgentRole; toolName: string; input: unknown }
  | { type: "tool-result"; role: AgentRole; toolName: string; output: unknown }
  | { type: "needs-approval"; role: AgentRole; action: string; code: string }
  | {
      type: "finding";
      role: AgentRole;
      id: string;
      content: string;
      cellType: string;
    }
  | { type: "finish"; role: AgentRole; text: string }
  | { type: "error"; role: AgentRole; message: string }
  | { type: "auto-approve"; role: AgentRole; value: boolean };

type ClientMessage =
  | { type: "start"; hypothesis: string; notebookContext?: string }
  | { type: "steer"; content: string }
  | { type: "stop" }
  | { type: "approve" }
  | { type: "reject"; feedback?: string }
  | { type: "sync" }
  | { type: "clear" }
  | { type: "set-auto-approve"; value: boolean };

const ALL_ROLES: AgentRole[] = ["engineer", "researcher", "reviewer"];

const initialState = (role: AgentRole): AgentState => ({
  role,
  status: "idle",
  autoApprove: false,
  activity: [],
  findings: [],
  messages: [],
  connected: false,
});

function getWsUrl(role: AgentRole, workspaceId: string): string {
  const base = AGENTS_URL.replace("http://", "ws://").replace(
    "https://",
    "wss://",
  );
  return `${base}/agents/persona-agent/${role}-${workspaceId}`;
}

export function useAgentConnections(workspaceId: Id<"workspaces"> | undefined) {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>({
    engineer: initialState("engineer"),
    researcher: initialState("researcher"),
    reviewer: initialState("reviewer"),
  });

  const socketsRef = useRef<Map<AgentRole, WebSocket>>(new Map());
  const reconnectTimeoutsRef = useRef<Map<AgentRole, NodeJS.Timeout>>(
    new Map(),
  );

  const updateAgent = useCallback(
    (role: AgentRole, update: Partial<AgentState>) => {
      setAgents((prev) => ({
        ...prev,
        [role]: { ...prev[role], ...update },
      }));
    },
    [],
  );

  const handleMessage = useCallback(
    (role: AgentRole, event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        switch (msg.type) {
          case "state":
            updateAgent(role, {
              status: msg.status,
              autoApprove: msg.autoApprove,
              activity: msg.activity,
              findings: msg.findings,
              messages: msg.messages,
              streamingText: undefined,
              streamId: undefined,
            });
            break;

          case "status":
            updateAgent(role, { status: msg.status });
            break;

          case "text-delta":
            updateAgent(role, {
              streamingText: msg.text,
              streamId: msg.streamId,
            });
            break;

          case "needs-approval":
            updateAgent(role, {
              status: "awaiting_approval",
              pendingCode: msg.code,
            });
            break;

          case "tool-call":
            setAgents((prev) => ({
              ...prev,
              [role]: {
                ...prev[role],
                activity: [
                  ...prev[role].activity,
                  {
                    id: `tool-${Date.now()}`,
                    type: "tool-call",
                    content: { toolName: msg.toolName, input: msg.input },
                    createdAt: Date.now(),
                  },
                ],
              },
            }));
            break;

          case "tool-result":
            setAgents((prev) => ({
              ...prev,
              [role]: {
                ...prev[role],
                activity: [
                  ...prev[role].activity,
                  {
                    id: `result-${Date.now()}`,
                    type: "tool-result",
                    content: { toolName: msg.toolName, output: msg.output },
                    createdAt: Date.now(),
                  },
                ],
              },
            }));
            break;

          case "finding":
            setAgents((prev) => ({
              ...prev,
              [role]: {
                ...prev[role],
                findings: [
                  ...prev[role].findings,
                  {
                    id: msg.id,
                    content: msg.content,
                    cellType: msg.cellType,
                    createdAt: Date.now(),
                    syncedToNotebook: false,
                  },
                ],
              },
            }));
            break;

          case "finish":
            updateAgent(role, {
              status: "done",
              streamingText: undefined,
              streamId: undefined,
            });
            break;

          case "error":
            updateAgent(role, {
              status: "error",
              streamingText: undefined,
              streamId: undefined,
            });
            setAgents((prev) => ({
              ...prev,
              [role]: {
                ...prev[role],
                activity: [
                  ...prev[role].activity,
                  {
                    id: `error-${Date.now()}`,
                    type: "error",
                    content: { message: msg.message },
                    createdAt: Date.now(),
                  },
                ],
              },
            }));
            break;

          case "auto-approve":
            updateAgent(role, { autoApprove: msg.value });
            break;
        }
      } catch {
        console.error("Failed to parse message:", event.data);
      }
    },
    [updateAgent],
  );

  const connect = useCallback(
    (role: AgentRole, wsId: string) => {
      const existing = socketsRef.current.get(role);
      if (existing && existing.readyState === WebSocket.OPEN) return;

      const timeout = reconnectTimeoutsRef.current.get(role);
      if (timeout) clearTimeout(timeout);

      const ws = new WebSocket(getWsUrl(role, wsId));

      ws.onopen = () => {
        updateAgent(role, { connected: true });
        ws.send(JSON.stringify({ type: "sync" }));
      };

      ws.onmessage = (e) => handleMessage(role, e);

      ws.onclose = () => {
        updateAgent(role, { connected: false });
        socketsRef.current.delete(role);
        const t = setTimeout(() => connect(role, wsId), 2000);
        reconnectTimeoutsRef.current.set(role, t);
      };

      ws.onerror = () => {
        ws.close();
      };

      socketsRef.current.set(role, ws);
    },
    [handleMessage, updateAgent],
  );

  useEffect(() => {
    if (!workspaceId) return;

    for (const role of ALL_ROLES) {
      connect(role, workspaceId);
    }

    return () => {
      for (const ws of socketsRef.current.values()) {
        ws.close();
      }
      socketsRef.current.clear();
      for (const timeout of reconnectTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      reconnectTimeoutsRef.current.clear();
    };
  }, [workspaceId, connect]);

  const send = useCallback((role: AgentRole, message: ClientMessage) => {
    const ws = socketsRef.current.get(role);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const sendAll = useCallback(
    (message: ClientMessage) => {
      for (const role of ALL_ROLES) {
        send(role, message);
      }
    },
    [send],
  );

  const startResearch = useCallback(
    (hypothesis: string, notebookContext?: string) => {
      sendAll({ type: "start", hypothesis, notebookContext });
    },
    [sendAll],
  );

  const steer = useCallback(
    (role: AgentRole, content: string) => {
      send(role, { type: "steer", content });
    },
    [send],
  );

  const stop = useCallback(
    (role: AgentRole) => {
      send(role, { type: "stop" });
    },
    [send],
  );

  const stopAll = useCallback(() => {
    sendAll({ type: "stop" });
  }, [sendAll]);

  const approve = useCallback(
    (role: AgentRole) => {
      send(role, { type: "approve" });
    },
    [send],
  );

  const reject = useCallback(
    (role: AgentRole, feedback?: string) => {
      send(role, { type: "reject", feedback });
    },
    [send],
  );

  const clear = useCallback(
    (role: AgentRole) => {
      send(role, { type: "clear" });
    },
    [send],
  );

  const clearAll = useCallback(() => {
    sendAll({ type: "clear" });
  }, [sendAll]);

  const setAutoApprove = useCallback(
    (role: AgentRole, value: boolean) => {
      send(role, { type: "set-auto-approve", value });
    },
    [send],
  );

  const hasActiveAgents = Object.values(agents).some((a) =>
    ["thinking", "working", "awaiting_approval"].includes(a.status),
  );

  const isConnected = Object.values(agents).every((a) => a.connected);

  return {
    agents,
    hasActiveAgents,
    isConnected,
    startResearch,
    steer,
    stop,
    stopAll,
    approve,
    reject,
    clear,
    clearAll,
    setAutoApprove,
  };
}
