export function getISO8601Timestamp(): string {
	return new Date().toISOString();
}

export function contentArrayToString(content: unknown): string {
	if (Array.isArray(content) && content.length > 0) {
		return typeof content[0] === "string"
			? content[0]
			: content[0].text || content[0].content || "";
	}
	return typeof content === "string" ? content : "";
}

/**
 * Normalize message content for LLM consumption.
 * Simplified version — no OpenNote-specific content part transforms.
 */
export function normalizeMessageContent(content: unknown): unknown {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content.map((item) => {
			if (
				item &&
				typeof item === "object" &&
				("type" in item || "toolCallId" in item || "toolName" in item)
			) {
				// Normalize tool-result parts to match AI SDK v6 schema
				if (item.type === "tool-result" && "toolCallId" in item) {
					const toolResult = item as {
						type: "tool-result";
						toolCallId: string;
						toolName?: string;
						output?: unknown;
						result?: unknown;
					};

					const rawOutput = toolResult.output ?? toolResult.result;

					let normalizedOutput: unknown;
					if (
						rawOutput &&
						typeof rawOutput === "object" &&
						"type" in rawOutput &&
						typeof (rawOutput as { type: unknown }).type ===
							"string" &&
						[
							"text",
							"json",
							"error-text",
							"error-json",
							"content",
							"execution-denied",
						].includes((rawOutput as { type: string }).type)
					) {
						normalizedOutput = rawOutput;
					} else {
						normalizedOutput =
							typeof rawOutput === "string"
								? { type: "text", value: rawOutput }
								: { type: "json", value: rawOutput ?? null };
					}

					return {
						type: "tool-result" as const,
						toolCallId: toolResult.toolCallId,
						toolName: toolResult.toolName ?? "unknown",
						output: normalizedOutput,
					};
				}

				if (
					item.type === "tool-call" ||
					item.type === "tool-use" ||
					item.type === "tool_use" ||
					"toolCallId" in item
				) {
					const normalized = { ...item };
					normalized.input = normalizeToolInput(item.input);
					return normalized;
				}
			}
			if (item && typeof item === "object") {
				return normalizeMessageContent(item);
			}
			return item;
		});
	}

	if (content && typeof content === "object") {
		const obj = content as Record<string, unknown>;
		if ("toolCallId" in obj || "toolName" in obj) {
			return {
				...obj,
				input: normalizeToolInput(obj.input),
			};
		}
	}

	return content;
}

export function normalizeToolInput(input: unknown): Record<string, unknown> {
	if (input && typeof input === "object" && !Array.isArray(input)) {
		return input as Record<string, unknown>;
	}

	if (typeof input === "string") {
		try {
			const parsed = JSON.parse(input);
			if (
				parsed &&
				typeof parsed === "object" &&
				!Array.isArray(parsed)
			) {
				return parsed;
			}
			return { value: input };
		} catch {
			return { value: input };
		}
	}

	if (input === null || input === undefined) {
		return {};
	}

	return { value: input };
}
