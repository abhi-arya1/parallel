import { Container } from "@cloudflare/containers";

export class SandboxContainer extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = "30m"; // Sleep after 30 minutes of inactivity

  envVars = {
    CONVEX_URL: this.env.CONVEX_URL,
    INTERNAL_API_KEY: this.env.INTERNAL_API_KEY,
    MODAL_TOKEN_ID: this.env.MODAL_TOKEN_ID,
    MODAL_TOKEN_SECRET: this.env.MODAL_TOKEN_SECRET,
  };

  override onStart() {
    console.log("Sandbox container started");
  }

  override onStop() {
    console.log("Sandbox container stopped");
  }

  override onError(error: unknown) {
    console.error("Sandbox container error:", error);
  }
}
