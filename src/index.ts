import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAccessToken, parseServiceAccount } from "./auth/jwt";
import {
  inspectUrl,
  listSitemaps,
  listSites,
  querySearchAnalytics,
} from "./gsc";

interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  MCP_BEARER_TOKEN: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const dimensionSchema = z.enum([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
  "date",
]);

const searchTypeSchema = z.enum([
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
]);

function asJsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export class GSCMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "gsc-mcp-connector",
    version: "0.1.0",
  });

  async init() {
    const sa = parseServiceAccount(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);

    this.server.tool(
      "list_sites",
      "List every Search Console property the configured service account has access to. Use this first to discover available siteUrl values.",
      {},
      async () => {
        const token = await getAccessToken(sa);
        const data = await listSites(token);
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "query_search_analytics",
      "Query Google Search Console performance data (clicks, impressions, CTR, average position) for a site. Supports breakdown by query, page, country, device, search appearance, or date.",
      {
        siteUrl: z
          .string()
          .describe(
            "Property identifier (e.g. 'sc-domain:example.com' for a Domain property, or 'https://example.com/' for a URL-prefix property). Get this from list_sites.",
          ),
        startDate: z.string().describe("Start date (YYYY-MM-DD, inclusive)"),
        endDate: z.string().describe("End date (YYYY-MM-DD, inclusive)"),
        dimensions: z
          .array(dimensionSchema)
          .optional()
          .describe("Up to 3 dimensions to group by"),
        type: searchTypeSchema
          .optional()
          .describe("Search type filter (default: web)"),
        rowLimit: z
          .number()
          .int()
          .min(1)
          .max(25000)
          .optional()
          .describe("Max rows to return (default 1000, max 25000)"),
        startRow: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset (default 0)"),
        dataState: z
          .enum(["final", "all"])
          .optional()
          .describe("'all' includes fresh data; 'final' is the default"),
        aggregationType: z
          .enum(["auto", "byPage", "byProperty"])
          .optional()
          .describe("How metrics are aggregated"),
        filterDimension: dimensionSchema
          .optional()
          .describe("Optional single-filter convenience: dimension to filter on"),
        filterOperator: z
          .enum([
            "equals",
            "notEquals",
            "contains",
            "notContains",
            "includingRegex",
            "excludingRegex",
          ])
          .optional()
          .describe("Optional single-filter convenience: operator"),
        filterExpression: z
          .string()
          .optional()
          .describe("Optional single-filter convenience: expression"),
      },
      async (args) => {
        const token = await getAccessToken(sa);
        const {
          siteUrl,
          filterDimension,
          filterOperator,
          filterExpression,
          ...rest
        } = args;

        const body: Parameters<typeof querySearchAnalytics>[2] = {
          startDate: rest.startDate,
          endDate: rest.endDate,
          dimensions: rest.dimensions,
          type: rest.type,
          rowLimit: rest.rowLimit ?? 1000,
          startRow: rest.startRow ?? 0,
          dataState: rest.dataState,
          aggregationType: rest.aggregationType,
        };

        if (filterDimension && filterExpression) {
          body.dimensionFilterGroups = [
            {
              groupType: "and",
              filters: [
                {
                  dimension: filterDimension,
                  operator: filterOperator ?? "equals",
                  expression: filterExpression,
                },
              ],
            },
          ];
        }

        const data = await querySearchAnalytics(token, siteUrl, body);
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "inspect_url",
      "Run the URL Inspection API on a single URL: indexing status, last crawl, canonical, mobile usability, AMP and rich-result issues.",
      {
        siteUrl: z
          .string()
          .describe("Property identifier owning the URL (e.g. 'sc-domain:example.com')"),
        inspectionUrl: z
          .string()
          .describe("Fully-qualified URL to inspect, must belong to siteUrl"),
        languageCode: z
          .string()
          .optional()
          .describe("BCP-47 language code, default 'en-US'"),
      },
      async (args) => {
        const token = await getAccessToken(sa);
        const data = await inspectUrl(token, {
          siteUrl: args.siteUrl,
          inspectionUrl: args.inspectionUrl,
          languageCode: args.languageCode ?? "en-US",
        });
        return asJsonContent(data);
      },
    );

    this.server.tool(
      "list_sitemaps",
      "List every sitemap submitted for a Search Console property, with last submission and processing status.",
      {
        siteUrl: z
          .string()
          .describe("Property identifier (e.g. 'sc-domain:example.com')"),
      },
      async (args) => {
        const token = await getAccessToken(sa);
        const data = await listSitemaps(token, args.siteUrl);
        return asJsonContent(data);
      },
    );
  }
}

function unauthorized(message: string): Response {
  return new Response(message, {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="gsc-mcp-connector"' },
  });
}

function checkAuth(request: Request, expectedToken: string): Response | null {
  if (!expectedToken) {
    return unauthorized(
      "Server misconfigured: MCP_BEARER_TOKEN secret is not set.",
    );
  }
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expectedToken}`) {
    return unauthorized("Missing or invalid bearer token.");
  }
  return null;
}

const LANDING = `gsc-mcp-connector
Self-hosted Google Search Console MCP server on Cloudflare Workers.

Endpoints:
  POST /mcp        Streamable HTTP MCP transport (recommended for ChatGPT)
  GET  /sse        Server-Sent Events MCP transport (legacy clients)

Auth:
  Authorization: Bearer <MCP_BEARER_TOKEN>

Source: https://github.com/JuJu78/gsc-mcp-connector
`;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(LANDING, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: { "content-type": "text/plain" },
      });
    }

    const authError = checkAuth(request, env.MCP_BEARER_TOKEN);
    if (authError) return authError;

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return GSCMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return GSCMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
