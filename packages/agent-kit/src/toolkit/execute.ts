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
      "Execute Python code in a sandboxed environment with GPU support. Use this for data analysis, ML experiments, and scientific computing.",
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

const executeBashInputSchema = z.object({
  command: z.string().describe("Bash command to execute"),
});

export const createExecuteBashTool = (
  sandboxUrl: string,
  workspaceId: string,
) =>
  tool({
    description:
      "Execute a bash command in the sandbox environment. Use this for file operations, installing packages, running CLI tools, and system commands.",
    inputSchema: executeBashInputSchema,
    execute: async (args: z.infer<typeof executeBashInputSchema>) => {
      const response = await fetch(`${sandboxUrl}/bash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          command: args.command,
          agent_mode: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const result = (await response.json()) as {
        success: boolean;
        stdout: string;
        stderr: string;
        exit_code: number;
        error?: string;
      };
      return {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        error: result.error,
      };
    },
  });
