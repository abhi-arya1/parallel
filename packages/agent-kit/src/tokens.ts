import type { ModelMessage } from "ai";

const TOKENS_PER_CHARACTER = 3;

export function estimateTextTokens(value: unknown): number {
	if (value === null || value === undefined) return 0;

	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		text = JSON.stringify(value);
	}

	const normalized = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
	const chars = normalized.length;

	if (chars < 20) {
		const roughWords = normalized
			.split(/[\s.,!?;:()"'`]+/)
			.filter(Boolean).length;
		return Math.max(roughWords, Math.ceil(chars / TOKENS_PER_CHARACTER));
	}

	return Math.ceil(chars / TOKENS_PER_CHARACTER);
}

export function estimateTokens(
	text: string | ModelMessage["content"],
): number {
	if (!text) return 0;

	if (typeof text === "string") {
		return estimateTextTokens(text);
	}

	if (Array.isArray(text)) {
		const textContent = text
			.map((part) => {
				if (typeof part === "string") {
					return part;
				}
				if (part && typeof part === "object" && "type" in part) {
					if (
						part.type === "text" &&
						"text" in part &&
						typeof part.text === "string"
					) {
						return part.text;
					}

					if (
						part.type === "reasoning" &&
						"text" in part &&
						typeof part.text === "string"
					) {
						return part.text;
					}

					if (part.type === "tool-result") {
						return JSON.stringify(part.output);
					}

					if (part.type === "tool-call") {
						return JSON.stringify(part.input);
					}
				}
				return "";
			})
			.filter(Boolean)
			.join(" ");

		return estimateTextTokens(textContent);
	}

	return 0;
}

export function estimateMessagesTokens(
	messages: ModelMessage[],
	padding: number = 0,
	paddingTotal: number = 100,
): number {
	let total = 0;

	for (const message of messages) {
		total += estimateTokens(message.content) + padding;
	}

	return total + paddingTotal;
}
