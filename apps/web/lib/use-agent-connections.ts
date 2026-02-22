"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useAgent } from "agents/react";
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
      agentId: AgentRole;
      status: AgentStatus;
      activity: Activity[];
      findings: Finding[];
      messages: Message[];
    }
  | { type: "status"; agentId: AgentRole; status: AgentStatus }
  | { type: "text-delta"; agentId: AgentRole; text: string; streamId: string }
  | { type: "tool-call"; agentId: AgentRole; toolName: string; input: unknown }
  | {
      type: "tool-result";
      agentId: AgentRole;
      toolName: string;
      output: unknown;
    }
  | { type: "needs-approval"; agentId: AgentRole; action: string; code: string }
  | {
      type: "finding";
      agentId: AgentRole;
      id: string;
      content: string;
      cellType: string;
    }
  | { type: "finish"; agentId: AgentRole; text: string }
  | { type: "error"; agentId: AgentRole; message: string };

type ClientMessage =
  | {
      type: "start";
      agentId: AgentRole;
      hypothesis: string;
      notebookContext?: string;
    }
  | { type: "steer"; agentId: AgentRole; content: string }
  | { type: "stop"; agentId: AgentRole }
  | { type: "approve"; agentId: AgentRole }
  | { type: "reject"; agentId: AgentRole; feedback?: string }
  | { type: "sync"; agentId: AgentRole }
  | { type: "clear"; agentId: AgentRole };

const ALL_ROLES: AgentRole[] = ["engineer", "researcher", "reviewer"];

const initialState = (role: AgentRole): AgentState => ({
  role,
  status: "idle",
  activity: [],
  findings: [],
  messages: [],
  connected: false,
});

export function useAgentConnections(workspaceId: Id<"workspaces"> | undefined) {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>({
    engineer: initialState("engineer"),
    researcher: initialState("researcher"),
    reviewer: initialState("reviewer"),
  });

  // Ref to access connection from handleMessage without circular deps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectionRef = useRef<any>(null);

  const sendSync = useCallback((agentId: AgentRole) => {
    const conn = connectionRef.current;
    if (conn && conn.readyState === WebSocket.OPEN) {
      conn.send(JSON.stringify({ type: "sync", agentId }));
    }
  }, []);

  const updateAgent = useCallback(
    (agentId: AgentRole, update: Partial<AgentState>) => {
      setAgents((prev) => ({
        ...prev,
        [agentId]: { ...prev[agentId], ...update },
      }));
    },
    [],
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        const agentId = msg.agentId;
        console.log(`[Agent:${agentId}] Received:`, msg.type, msg);

        switch (msg.type) {
          case "state":
            updateAgent(agentId, {
              status: msg.status,
              activity: msg.activity,
              findings: msg.findings,
              messages: msg.messages,
              streamingText: undefined,
              streamId: undefined,
            });
            break;

          case "status":
            updateAgent(agentId, { status: msg.status });
            break;

          case "text-delta":
            updateAgent(agentId, {
              streamingText: msg.text,
              streamId: msg.streamId,
            });
            break;

          case "needs-approval":
            updateAgent(agentId, {
              status: "awaiting_approval",
              pendingCode: msg.code,
            });
            break;

          case "tool-call":
            setAgents((prev) => ({
              ...prev,
              [agentId]: {
                ...prev[agentId],
                activity: [
                  ...prev[agentId].activity,
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
              [agentId]: {
                ...prev[agentId],
                activity: [
                  ...prev[agentId].activity,
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
              [agentId]: {
                ...prev[agentId],
                findings: [
                  ...prev[agentId].findings,
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
            // Clear streaming state - the assistant message is already
            // saved server-side and will come via the state sync
            updateAgent(agentId, {
              status: "done",
              streamingText: undefined,
              streamId: undefined,
            });
            // Request fresh state from server to get the persisted message
            sendSync(agentId);
            break;

          case "error":
            updateAgent(agentId, {
              status: "error",
              streamingText: undefined,
              streamId: undefined,
            });
            setAgents((prev) => ({
              ...prev,
              [agentId]: {
                ...prev[agentId],
                activity: [
                  ...prev[agentId].activity,
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
        }
      } catch {
        console.error("Failed to parse message:", event.data);
      }
    },
    [updateAgent, sendSync],
  );

  const handleOpen = useCallback(() => {
    setAgents((prev) => {
      const updated = { ...prev };
      for (const role of ALL_ROLES) {
        updated[role] = { ...updated[role], connected: true };
      }
      return updated;
    });
  }, []);

  const handleClose = useCallback(() => {
    setAgents((prev) => {
      const updated = { ...prev };
      for (const role of ALL_ROLES) {
        updated[role] = { ...updated[role], connected: false };
      }
      return updated;
    });
  }, []);

  const connection = useAgent({
    agent: "workspace-agent",
    name: workspaceId || "",
    host: AGENTS_URL,
    onMessage: handleMessage,
    onOpen: handleOpen,
    onClose: handleClose,
  });

  // Keep ref in sync for use in handleMessage
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const send = useCallback(
    (message: ClientMessage) => {
      if (connection && connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify(message));
      }
    },
    [connection],
  );

  const syncAgent = useCallback(
    (agentId: AgentRole) => {
      send({ type: "sync", agentId });
    },
    [send],
  );

  useEffect(() => {
    if (!workspaceId || !connection || connection.readyState !== WebSocket.OPEN)
      return;
    for (const role of ALL_ROLES) {
      syncAgent(role);
    }
  }, [workspaceId, connection?.readyState, syncAgent]);

  const startResearch = useCallback(
    (hypothesis: string, notebookContext?: string) => {
      for (const role of ALL_ROLES) {
        send({ type: "start", agentId: role, hypothesis, notebookContext });
      }
    },
    [send],
  );

  const steer = useCallback(
    (role: AgentRole, content: string) => {
      setAgents((prev) => ({
        ...prev,
        [role]: {
          ...prev[role],
          messages: [
            ...prev[role].messages,
            { role: "user" as const, content, timestamp: Date.now() },
          ],
          status: "thinking" as AgentStatus,
        },
      }));
      send({ type: "steer", agentId: role, content });
    },
    [send],
  );

  const stop = useCallback(
    (role: AgentRole) => {
      send({ type: "stop", agentId: role });
    },
    [send],
  );

  const stopAll = useCallback(() => {
    for (const role of ALL_ROLES) {
      send({ type: "stop", agentId: role });
    }
  }, [send]);

  const approve = useCallback(
    (role: AgentRole) => {
      send({ type: "approve", agentId: role });
    },
    [send],
  );

  const reject = useCallback(
    (role: AgentRole, feedback?: string) => {
      send({ type: "reject", agentId: role, feedback });
    },
    [send],
  );

  const clear = useCallback(
    (role: AgentRole) => {
      setAgents((prev) => ({
        ...prev,
        [role]: initialState(role),
      }));
      send({ type: "clear", agentId: role });
    },
    [send],
  );

  const clearAll = useCallback(() => {
    for (const role of ALL_ROLES) {
      setAgents((prev) => ({
        ...prev,
        [role]: initialState(role),
      }));
      send({ type: "clear", agentId: role });
    }
  }, [send]);

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
    syncAgent,
  };
}
