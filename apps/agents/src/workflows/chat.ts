import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';

export type ChatWorkflowParams = {
	messages: Array<{ role: string; content: string }>;
	model?: string;
	systemPrompt?: string;
};

export type ChatWorkflowResult = {
	response: string;
	tokenCount?: number;
};

export class ChatWorkflow extends WorkflowEntrypoint<Env, ChatWorkflowParams> {
	async run(event: WorkflowEvent<ChatWorkflowParams>, step: WorkflowStep): Promise<ChatWorkflowResult> {
		const { messages, model = 'openai/gpt-4o-mini', systemPrompt } = event.payload;

		// Step 1: Prepare messages with optional system prompt
		const preparedMessages = await step.do('prepare-messages', async () => {
			const allMessages: Array<{ role: string; content: string }> = [];

			if (systemPrompt) {
				allMessages.push({
					role: 'system',
					content: systemPrompt,
				});
			}

			allMessages.push(...messages);
			return allMessages;
		});

		// Step 2: Generate AI response
		const result = await step.do('generate-response', async () => {
			const gateway = createGateway({
				baseURL: 'https://gateway.ai.cloudflare.com/v1',
			});

			const response = await generateText({
				model: gateway(model),
				messages: preparedMessages as Array<{
					role: 'user' | 'assistant' | 'system';
					content: string;
				}>,
			});

			return {
				text: response.text,
				tokenCount: response.usage?.totalTokens,
			};
		});

		// Step 3: Log completion
		await step.do('log-completion', async () => {
			console.log(`Workflow completed with ${result.tokenCount ?? 0} tokens`);
			return true;
		});

		return {
			response: result.text,
			tokenCount: result.tokenCount,
		};
	}
}
