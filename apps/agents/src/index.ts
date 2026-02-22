import { routeAgentRequest } from "agents";

export { ParallelAgent } from "./agent";
export { WorkspaceAgent } from "./workspace-agent";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok", timestamp: Date.now() });
    }

    const agentResponse = await routeAgentRequest(request, env, {
      cors: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });

    if (agentResponse) return agentResponse;

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
