import { tool } from "ai";
import { z } from "zod";

const executeCodeInputSchema = z.object({
  code: z.string().describe("Python code to execute"),
});

export const createExecuteCodeTool = (
  sandboxUrl: string,
  workspaceId: string,
) =>
  tool({
    description:
      "Execute Python code in a sandboxed environment with GPU support",
    inputSchema: executeCodeInputSchema,
    execute: async (args: z.infer<typeof executeCodeInputSchema>) => {
      const response = await fetch(`${sandboxUrl}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          code: args.code,
          agent_mode: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      return response.json();
    },
  });
