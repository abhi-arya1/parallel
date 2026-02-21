import type React from "react";
import type {
	Chunk,
	Message,
	ExtendedAssistantContent,
} from "@repo/agent-kit";
import type { TextPart } from "ai";

// Type for message content array items
type MessageContentItem = Exclude<ExtendedAssistantContent, string>[number];

// Type for pending tool call part
type PendingToolCallPart = {
	type: "pending-tool-call";
	toolName: string;
	id: string;
};

// Type for error tool result
type ErrorToolResult = {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: {
		type: "error-text";
		value: string;
	};
};

/**
 * Get content as an array of message content items
 */
export const getContentArray = (
	content: Message["content"],
): MessageContentItem[] => {
	if (Array.isArray(content)) {
		return content as MessageContentItem[];
	}
	if (typeof content === "string") {
		return [{ type: "text" as const, text: content }];
	}
	return [];
};

/**
 * Check if a part is a text part
 */
export const isTextPart = (part: MessageContentItem): part is TextPart => {
	return (
		typeof part === "object" &&
		part !== null &&
		"type" in part &&
		part.type === "text"
	);
};

/**
 * Extract text from a message content item
 */
export const getTextFromPart = (part: MessageContentItem): string => {
	if (isTextPart(part)) {
		return part.text;
	}
	return "";
};

/**
 * Extract all pending tool calls from message content
 */
export const extractPendingToolCalls = (
	content: Message["content"],
): PendingToolCallPart[] => {
	const contentArray = getContentArray(content);
	return contentArray.filter(
		(part) =>
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			part.type === "pending-tool-call",
	) as PendingToolCallPart[];
};

/**
 * Extract all tool result IDs from message content
 */
export const extractToolResultIds = (
	content: Message["content"],
): Set<string> => {
	const contentArray = getContentArray(content);
	return new Set(
		contentArray
			.filter(
				(part) =>
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "tool-result",
			)
			.map((part) =>
				typeof part === "object" &&
				part !== null &&
				"toolCallId" in part &&
				typeof part.toolCallId === "string"
					? part.toolCallId
					: null,
			)
			.filter((id): id is string => id !== null),
	);
};

/**
 * Convert failed pending tool calls to error tool results
 */
export const convertFailedToolCallsToErrors = (
	content: Message["content"],
): ErrorToolResult[] => {
	const pendingToolCalls = extractPendingToolCalls(content);
	const toolResultIds = extractToolResultIds(content);

	return pendingToolCalls
		.filter((pending) => !toolResultIds.has(pending.id))
		.map((pending) => ({
			type: "tool-result" as const,
			toolCallId: pending.id,
			toolName: pending.toolName,
			output: {
				type: "error-text" as const,
				value: "Tool call failed during execution",
			},
		}));
};

/**
 * Remove all pending tool calls from message content
 */
export const removePendingToolCalls = (
	content: Message["content"],
): MessageContentItem[] => {
	const contentArray = getContentArray(content);
	return contentArray.filter(
		(part) =>
			!(
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				part.type === "pending-tool-call"
			),
	);
};

/**
 * Check if message content has any pending tool calls
 */
export const hasPendingToolCall = (content: Message["content"]): boolean => {
	const contentArray = getContentArray(content);
	return contentArray.some(
		(part) =>
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			part.type === "pending-tool-call",
	);
};

/**
 * Update pending tool call ref based on chunk type
 */
export const updatePendingToolCallRef = (
	chunk: Chunk,
	pendingToolCallRef: React.MutableRefObject<Extract<
		Chunk,
		{ type: "tool-input-start" }
	> | null>,
): void => {
	if (chunk.type === "tool-input-start") {
		pendingToolCallRef.current = chunk as Extract<
			Chunk,
			{ type: "tool-input-start" }
		>;
	} else if (chunk.type === "tool-result") {
		if (
			pendingToolCallRef.current &&
			pendingToolCallRef.current.id ===
				(chunk as Extract<Chunk, { type: "tool-result" }>).toolCallId
		) {
			pendingToolCallRef.current = null;
		}
	} else if (chunk.type === "text-delta") {
		if (pendingToolCallRef.current) {
			pendingToolCallRef.current = null;
		}
	} else if (chunk.type === "finish" || chunk.type === "error") {
		pendingToolCallRef.current = null;
	}
};
