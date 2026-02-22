import { Hono } from "hono";
import { cors } from "hono/cors";
import { SandboxContainer } from "./lib/container";

type Env = {
  SANDBOX_CONTAINER: DurableObjectNamespace<SandboxContainer>;
  CONVEX_URL: string;
  INTERNAL_API_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use("*", cors());

// Health check
app.get("/", (c) => c.text("Sandboxes API"));

app.get("/health", (c) => c.json({ status: "ok" }));

// Proxy all requests to the container
async function proxyToContainer(
  c: { env: Env; req: { raw: Request } },
  path: string,
): Promise<Response> {
  const id = c.env.SANDBOX_CONTAINER.idFromName("default");
  const stub = c.env.SANDBOX_CONTAINER.get(id);

  // Build the container URL
  const containerUrl = new URL(path, "http://container");

  // Copy the original request
  const req = new Request(containerUrl.toString(), {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });

  return stub.fetch(req);
}

// Kernel management
app.get("/kernel/:workspaceId/status", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  return proxyToContainer(c, `/kernel/${workspaceId}/status`);
});

app.post("/kernel/:workspaceId/start", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  return proxyToContainer(c, `/kernel/${workspaceId}/start`);
});

app.post("/kernel/:workspaceId/stop", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  return proxyToContainer(c, `/kernel/${workspaceId}/stop`);
});

app.post("/kernel/:workspaceId/restart", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  return proxyToContainer(c, `/kernel/${workspaceId}/restart`);
});

// Execution
app.post("/execute", async (c) => {
  return proxyToContainer(c, "/execute");
});

app.post("/execute/:workspaceId/:cellId", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const cellId = c.req.param("cellId");
  return proxyToContainer(c, `/execute/${workspaceId}/${cellId}`);
});

// Streaming execution
app.get("/stream/:workspaceId/:cellId", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const cellId = c.req.param("cellId");
  return proxyToContainer(c, `/stream/${workspaceId}/${cellId}`);
});

// Bash execution
app.post("/bash", async (c) => {
  return proxyToContainer(c, "/bash");
});

// Error handler
app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: err.message }, 500);
});

export { SandboxContainer };

export default {
  fetch: app.fetch,
};
