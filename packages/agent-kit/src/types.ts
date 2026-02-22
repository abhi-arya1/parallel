import type {
  AssistantContent,
  AssistantModelMessage,
  ModelMessage,
  UserContent,
  UserModelMessage,
} from "ai";

/**
 * Tool result info stored in stream state for resumption
 */
export type StreamToolResult = {
  toolCallId: string;
  toolName: string;
  output: unknown;
};

/**
 * Pending tool call info stored in stream state
 */
export type StreamPendingToolCall = {
  toolName: string;
  id: string;
};

/**
 * A content part in the stream state, preserving order of text and tool results.
 * Used for stream resumption to restore the exact sequence of streamed content.
 */
export type StreamContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

/**
 * Stream resume chunk sent when a client reconnects to an active stream.
 * Contains the accumulated state so the client can reconstruct the message
 * and continue receiving new chunks.
 */
export type StreamResumeChunk = {
  type: "stream-resume";
  conversationId: string;
  contentParts: StreamContentPart[];
  pendingToolCall?: StreamPendingToolCall | null;
  chunkIndex: number;
  previousMessages?: Message[];
  userMessageContent?: UserMessageContent;
};

/**
 * Stopped chunk sent when a stream is cancelled by the user or times out.
 */
export type StoppedChunk = {
  type: "stopped";
  conversationId: string;
  reason: "user-cancelled" | "timeout";
};

/**
 * Message sent from client to server to request stopping an active stream.
 */
export type StopStreamMessage = {
  type: "stop-stream";
  conversationId: string;
};

/**
 * Union of all chunk types that can be sent over the wire.
 * TextStreamPart comes from `ai` SDK's streamText, augmented with conversationId.
 */
export type Chunk =
  | ({ conversationId: string } & TextStreamPart)
  | StreamResumeChunk
  | StoppedChunk;

/**
 * Minimal TextStreamPart — the chunk types emitted by the AI SDK's streamText.
 * We define the subset we actually use rather than importing the full generic type.
 */
export type TextStreamPart =
  | { type: "text-delta"; text: string; id: string }
  | {
      type: "tool-input-start";
      id: string;
      toolName: string;
    }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      dynamic?: boolean;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      input: unknown;
      output: unknown;
      dynamic?: boolean;
    }
  | {
      type: "finish";
      finishReason: string;
      rawFinishReason?: string;
      totalUsage?: { inputTokens: number; outputTokens: number };
    }
  | {
      type: "error";
      content: string | { errorAt: string };
    };

export type PendingToolCallPart = {
  type: "pending-tool-call";
  toolName: string;
  id: string;
};

export type ErrorPart = {
  type: "error";
  content: string | { errorAt: string };
};

export type ExtendedAssistantContent =
  | Extract<AssistantContent, string>
  | Array<
      | Extract<AssistantContent, readonly any[]>[number]
      | PendingToolCallPart
      | ErrorPart
    >;

export type ExtendedAssistantModelMessage = Omit<
  AssistantModelMessage,
  "content"
> & {
  content: ExtendedAssistantContent;
};

/**
 * User message content — standard AI SDK user content.
 */
export type UserMessageContent = UserModelMessage["content"];

export type Message = (
  | Exclude<ModelMessage, AssistantModelMessage>
  | Exclude<ModelMessage, UserModelMessage>
  | ExtendedAssistantModelMessage
) & {
  complete?: boolean;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

export type PaperCitation = {
  title: string;
  authors: string[];
  year: number;
  arxivId?: string;
  url: string;
  relevance: string;
};

export type ActivityContentPart =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "search-query"; queries: string[]; source: "web" | "arxiv" }
  | { type: "search-results"; results: SearchResult[] }
  | { type: "paper-citation"; paper: PaperCitation }
  | { type: "code-input"; code: string; language: string }
  | { type: "code-output"; output: string; images?: string[]; error?: string }
  | {
      type: "assumption";
      text: string;
      severity: "low" | "medium" | "high";
      why?: string;
    }
  | { type: "counterargument"; content: string }
  | { type: "experiment-design"; parameters: Record<string, unknown>[] }
  | { type: "finding-preview"; markdown: string }
  | { type: "error"; message: string };

export type AgentRole = "engineer" | "researcher" | "reviewer";

export type AgentStatus =
  | "spawning"
  | "thinking"
  | "working"
  | "working_hard"
  | "done"
  | "idle"
  | "error";
