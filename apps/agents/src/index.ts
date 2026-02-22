import { routeAgentRequest } from "agents";

export { ParallelAgent } from "./agent";
export { ParallelWorkflow } from "./workflow";
export { HypothesisWorkflow } from "./hypothesis";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return withCors(agentResponse);

    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok", timestamp: Date.now() });
    }

    if (url.pathname === "/hypothesis" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          workspaceId: string;
          hypothesis: string;
          agentIds: {
            engineer: string;
            researcher: string;
            reviewer: string;
          };
        };

        const instance = await env.HYPOTHESIS_WORKFLOW.create({
          params: {
            workspaceId: body.workspaceId,
            hypothesis: body.hypothesis,
            agentIds: body.agentIds,
            convexUrl: env.CONVEX_URL,
            syncKey: env.INTERNAL_API_KEY,
            syncServerUrl: env.SYNC_SERVER_URL,
            sandboxUrl: env.SANDBOX_URL,
            parallelApiKey: env.PARALLEL_API_KEY,
          },
        });

        return jsonResponse({ instanceId: instance.id });
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : "Unknown error" },
          500,
        );
      }
    }

    if (url.pathname === "/continue" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          workspaceId: string;
          agentId: string;
          role: "engineer" | "researcher" | "reviewer";
        };

        const agentIds = {
          engineer: body.role === "engineer" ? body.agentId : "",
          researcher: body.role === "researcher" ? body.agentId : "",
          reviewer: body.role === "reviewer" ? body.agentId : "",
        };

        const instance = await env.HYPOTHESIS_WORKFLOW.create({
          params: {
            workspaceId: body.workspaceId,
            hypothesis: "[Continue from user message]",
            agentIds,
            convexUrl: env.CONVEX_URL,
            syncKey: env.INTERNAL_API_KEY,
            syncServerUrl: env.SYNC_SERVER_URL,
            sandboxUrl: env.SANDBOX_URL,
            parallelApiKey: env.PARALLEL_API_KEY,
            continueAgentId: body.agentId,
            continueRole: body.role,
          },
        });

        return jsonResponse({ instanceId: instance.id });
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : "Unknown error" },
          500,
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
