import { routeAgentRequest } from 'agents';

export { ParallelAgent } from './agent';
export { ParallelWorkflow } from './workflow';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Try agent routing first (handles WebSocket upgrades and agent HTTP requests)
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) return agentResponse;

		// Health check endpoint
		if (url.pathname === '/health') {
			return Response.json({ status: 'ok', timestamp: Date.now() });
		}

		// Workflow trigger endpoint (HTTP API for starting workflows)
		if (url.pathname === '/api/workflow/chat' && request.method === 'POST') {
			try {
				const body = await request.json<{
					messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
					model?: string;
					systemPrompt?: string;
				}>();

				const instance = await env.PARALLEL_WORKFLOW.create({
					params: {
						messages: body.messages,
						model: body.model,
						systemPrompt: body.systemPrompt,
					},
				});

				return Response.json({
					id: instance.id,
					status: 'started',
				});
			} catch (error) {
				return Response.json({ error: 'Failed to start workflow' }, { status: 500 });
			}
		}

		// Workflow status endpoint
		if (url.pathname.startsWith('/api/workflow/') && request.method === 'GET') {
			const workflowId = url.pathname.split('/').pop();
			if (!workflowId || workflowId === 'workflow') {
				return Response.json({ error: 'Missing workflow ID' }, { status: 400 });
			}

			try {
				const instance = await env.PARALLEL_WORKFLOW.get(workflowId);
				const status = await instance.status();

				return Response.json({
					id: workflowId,
					status: status.status,
					output: status.output,
					error: status.error,
				});
			} catch (error) {
				return Response.json({ error: 'Workflow not found' }, { status: 404 });
			}
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
