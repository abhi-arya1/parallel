import { routeAgentRequest } from "agents";

export { ParallelAgent } from "./agent";

export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Try agent routing first (handles WebSocket upgrades and agent HTTP requests)
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) return agentResponse;

		// Health check endpoint
		if (url.pathname === "/health") {
			return Response.json({ status: "ok", timestamp: Date.now() });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
