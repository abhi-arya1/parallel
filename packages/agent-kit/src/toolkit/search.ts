import { tool } from "ai";
import { z } from "zod";

const PARALLEL_API_URL = "https://api.parallel.ai";

const searchWebInputSchema = z.object({
  objective: z.string().describe("What you're trying to find or learn"),
  queries: z
    .array(z.string())
    .max(5)
    .optional()
    .describe("Specific search queries (1-6 words each)"),
  maxResults: z.number().min(1).max(20).default(10),
});

const searchArxivInputSchema = z.object({
  query: z.string().describe("Search query for academic papers"),
  maxResults: z.number().min(1).max(10).default(5),
});

export const createSearchWebTool = (apiKey: string) =>
  tool({
    description:
      "Search the web for information relevant to a research objective",
    inputSchema: searchWebInputSchema,
    execute: async (args: z.infer<typeof searchWebInputSchema>) => {
      const response = await fetch(`${PARALLEL_API_URL}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          mode: "agentic",
          objective: args.objective,
          search_queries: args.queries,
          max_results: args.maxResults,
        }),
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      return response.json();
    },
  });

export const createSearchArxivTool = (apiKey: string) =>
  tool({
    description: "Search arXiv for academic papers and preprints",
    inputSchema: searchArxivInputSchema,
    execute: async (args: z.infer<typeof searchArxivInputSchema>) => {
      const response = await fetch(`${PARALLEL_API_URL}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          mode: "agentic",
          objective: `Find academic papers about: ${args.query}`,
          search_queries: [args.query],
          max_results: args.maxResults,
          site_filter: ["arxiv.org"],
        }),
      });

      if (!response.ok) {
        throw new Error(`arXiv search failed: ${response.statusText}`);
      }

      return response.json();
    },
  });
