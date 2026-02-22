import { tool } from "ai";
import { z } from "zod";
import { Parallel } from "parallel-web";

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_SEARCH_QUERIES = 5;

// =============================================================================
// SCHEMAS
// =============================================================================

const searchWebInputSchema = z.object({
  objective: z
    .string()
    .describe("Natural-language description of what the web research goal is."),
  queries: z
    .array(z.string())
    .max(MAX_SEARCH_QUERIES)
    .optional()
    .describe(
      `List of keyword search queries of 1-6 words. Maximum ${MAX_SEARCH_QUERIES} queries.`,
    ),
  maxResults: z.number().min(1).max(20).default(10),
});

const searchArxivInputSchema = z.object({
  query: z.string().describe("Search query for academic papers"),
  maxResults: z.number().min(1).max(10).default(5),
});

type ExtractType = "focused" | "detailed" | "full_page";

const extractInputSchema = z.object({
  objective: z
    .string()
    .describe(
      "Natural-language description of what information you're looking for from the URLs. Include context about your broader task for better extraction.",
    ),
  urls: z
    .array(z.string())
    .max(10)
    .describe("List of URLs to extract content from. Maximum 10 URLs."),
  queries: z
    .array(z.string())
    .max(MAX_SEARCH_QUERIES)
    .optional()
    .describe(
      `Optional keyword queries to emphasize specific terms. Maximum ${MAX_SEARCH_QUERIES} queries.`,
    ),
  extractType: z
    .enum(["focused", "detailed", "full_page"])
    .optional()
    .default("focused")
    .describe(
      "Controls extraction depth. 'focused' for quick relevant excerpts (default), 'detailed' for comprehensive excerpts, 'full_page' for complete page content.",
    ),
  freshness: z
    .enum(["cached", "fresh"])
    .optional()
    .default("cached")
    .describe(
      "Content freshness. 'cached' for fast indexed content (default), 'fresh' to fetch live content (slower, use for time-sensitive pages).",
    ),
});

// =============================================================================
// HELPERS
// =============================================================================

function getExtractSettings(extractType: ExtractType): {
  excerpts: boolean | { max_chars_per_result: number };
  full_content: boolean | { max_chars_per_result: number };
} {
  switch (extractType) {
    case "focused":
      return {
        excerpts: { max_chars_per_result: 5000 },
        full_content: false,
      };
    case "detailed":
      return {
        excerpts: { max_chars_per_result: 15000 },
        full_content: false,
      };
    case "full_page":
      return {
        excerpts: false,
        full_content: { max_chars_per_result: 30000 },
      };
  }
}

// =============================================================================
// TOOL FACTORIES
// =============================================================================

export const createSearchWebTool = (apiKey: string) => {
  const parallel = new Parallel({ apiKey });

  return tool({
    description:
      "Search the web for information relevant to a research objective",
    inputSchema: searchWebInputSchema,
    execute: async (
      args: z.infer<typeof searchWebInputSchema>,
      { abortSignal },
    ) => {
      const searchParams = {
        mode: "agentic" as const,
        objective: args.objective,
        search_queries: args.queries?.slice(0, MAX_SEARCH_QUERIES),
        max_results: args.maxResults,
      };

      const options = abortSignal ? { signal: abortSignal } : undefined;

      const results = await parallel.beta.search(searchParams, options);

      return {
        searchParams: args,
        answer: results,
      };
    },
  });
};

export const createSearchArxivTool = (apiKey: string) => {
  const parallel = new Parallel({ apiKey });

  return tool({
    description: "Search arXiv for academic papers and preprints",
    inputSchema: searchArxivInputSchema,
    execute: async (
      args: z.infer<typeof searchArxivInputSchema>,
      { abortSignal },
    ) => {
      const searchParams = {
        mode: "agentic" as const,
        objective: `Find academic papers about: ${args.query}`,
        search_queries: [args.query],
        max_results: args.maxResults,
        site_filter: ["arxiv.org"],
      };

      const options = abortSignal ? { signal: abortSignal } : undefined;

      const results = await parallel.beta.search(searchParams, options);

      return {
        searchParams: args,
        answer: results,
      };
    },
  });
};

export const createExtractTool = (apiKey: string) => {
  const parallel = new Parallel({ apiKey });

  return tool({
    description:
      "Extract content from specific URLs. Use this when you have URLs you want to read and extract information from.",
    inputSchema: extractInputSchema,
    execute: async (
      args: z.infer<typeof extractInputSchema>,
      { abortSignal },
    ) => {
      const options = abortSignal ? { signal: abortSignal } : undefined;

      const extractSettings = getExtractSettings(args.extractType ?? "focused");

      const fetchPolicy =
        args.freshness === "fresh"
          ? {
              max_age_seconds: 600,
              timeout_seconds: 60,
            }
          : undefined;

      const extractParams = {
        urls: args.urls.slice(0, 10),
        objective: args.objective,
        search_queries: args.queries?.slice(0, MAX_SEARCH_QUERIES),
        ...extractSettings,
        ...(fetchPolicy && { fetch_policy: fetchPolicy }),
      };

      const results = await parallel.beta.extract(extractParams, options);

      return {
        extractParams: args,
        answer: results,
      };
    },
  });
};

export { MAX_SEARCH_QUERIES };
