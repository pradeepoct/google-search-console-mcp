/**
 * Microsoft Clarity Data Export API wrapper & multi-project manager.
 * Official Documentation: https://learn.microsoft.com/en-us/clarity/setup-and-installation/data-export-api
 * API Endpoint: https://www.clarity.ms/export-data/api/v1/project-live-insights
 */

const CLARITY_API_BASE = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export type ClarityDimension =
  | "Browser"
  | "Device"
  | "Country"
  | "Country/Region"
  | "OS"
  | "Source"
  | "Medium"
  | "Campaign"
  | "Channel"
  | "URL";

export interface ClarityLiveInsightsParams {
  numOfDays: 1 | 2 | 3;
  dimension1?: ClarityDimension | string;
  dimension2?: ClarityDimension | string;
  dimension3?: ClarityDimension | string;
}

export interface ClarityMetricInformation {
  [key: string]: string | number | undefined;
  totalSessionCount?: string | number;
  totalBotSessionCount?: string | number;
  distinctUserCount?: string | number;
  pagesPerSessionPercentage?: string | number;
}

export interface ClarityMetricResult {
  metricName: string;
  information: ClarityMetricInformation[];
}

/**
 * Fetch live insights from Microsoft Clarity for a specific project token.
 * Note: Microsoft strictly enforces a quota of 10 requests per project per day.
 */
export async function fetchClarityLiveInsights(
  token: string,
  params: ClarityLiveInsightsParams,
): Promise<ClarityMetricResult[]> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error("No Microsoft Clarity API token provided.");
  }

  const url = new URL(CLARITY_API_BASE);
  url.searchParams.set("numOfDays", String(params.numOfDays));

  if (params.dimension1) url.searchParams.set("dimension1", params.dimension1);
  if (params.dimension2) url.searchParams.set("dimension2", params.dimension2);
  if (params.dimension3) url.searchParams.set("dimension3", params.dimension3);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Clarity API Authentication failed (${response.status}): The provided project token is invalid, expired, or unauthorized.`,
      );
    }
    if (response.status === 429) {
      throw new Error(
        `Clarity API Quota Exceeded (429): Microsoft Clarity strictly enforces a limit of 10 requests per project per day. Try again tomorrow or query a different project.`,
      );
    }
    throw new Error(`Clarity API error ${response.status} on ${url.pathname}: ${errorText}`);
  }

  return (await response.json()) as ClarityMetricResult[];
}

/**
 * Parse the configured project aliases from the CLARITY_PROJECT_TOKENS environment variable.
 */
export function parseClarityProjectTokens(
  rawJson?: string,
): Record<string, string> {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, string>;
    }
  } catch {
    // If it's invalid JSON, return empty map
  }
  return {};
}

/**
 * Persist a project token into Cloudflare KV.
 */
export async function saveProjectTokenToKV(
  kv: KVNamespace,
  projectName: string,
  token: string,
): Promise<void> {
  const key = `clarity:project:${projectName.toLowerCase().trim()}`;
  await kv.put(key, token.trim());
}

/**
 * Delete a project token from Cloudflare KV.
 */
export async function deleteProjectTokenFromKV(
  kv: KVNamespace,
  projectName: string,
): Promise<void> {
  const key = `clarity:project:${projectName.toLowerCase().trim()}`;
  await kv.delete(key);
}

/**
 * Retrieve a project token from Cloudflare KV.
 */
export async function getProjectTokenFromKV(
  kv: KVNamespace,
  projectName: string,
): Promise<string | null> {
  const key = `clarity:project:${projectName.toLowerCase().trim()}`;
  return await kv.get(key);
}

/**
 * List all configured projects across environment secrets and KV storage.
 */
export async function listAllClarityProjects(
  envProjectsJson?: string,
  defaultToken?: string,
  kv?: KVNamespace,
): Promise<{
  envProjects: string[];
  kvProjects: string[];
  allProjects: string[];
  hasDefaultToken: boolean;
}> {
  const envMap = parseClarityProjectTokens(envProjectsJson);
  const envProjects = Object.keys(envMap);

  let kvProjects: string[] = [];
  if (kv) {
    try {
      const list = await kv.list({ prefix: "clarity:project:" });
      kvProjects = list.keys.map((k) => k.name.replace("clarity:project:", ""));
    } catch {
      // KV listing fallback
    }
  }

  const allProjects = Array.from(new Set([...envProjects, ...kvProjects])).sort();

  return {
    envProjects,
    kvProjects,
    allProjects,
    hasDefaultToken: Boolean(defaultToken && defaultToken.trim()),
  };
}

/**
 * Resolve the project API token using a 4-tier hierarchy:
 * 1. Direct tool parameter override (args.apiToken)
 * 2. Lookup in CLARITY_PROJECT_TOKENS JSON map
 * 3. Lookup in Cloudflare KV (clarity:project:<name>)
 * 4. Fallback to operator default CLARITY_API_TOKEN
 */
export async function resolveClarityToken(
  projectArg: string | undefined,
  apiTokenArg: string | undefined,
  envProjectsJson: string | undefined,
  defaultToken: string | undefined,
  kv?: KVNamespace,
): Promise<{ token: string; resolvedProject: string; source: "argument" | "env_map" | "kv" | "default" }> {
  // 1. Direct tool parameter override
  if (apiTokenArg && apiTokenArg.trim()) {
    return {
      token: apiTokenArg.trim(),
      resolvedProject: projectArg || "custom-token",
      source: "argument",
    };
  }

  // 2. Lookup in CLARITY_PROJECT_TOKENS environment map
  const envMap = parseClarityProjectTokens(envProjectsJson);
  if (projectArg) {
    const trimmed = projectArg.trim();
    if (envMap[trimmed]) {
      return { token: envMap[trimmed].trim(), resolvedProject: trimmed, source: "env_map" };
    }

    // Case-insensitive match on envMap
    const lower = trimmed.toLowerCase();
    for (const [key, val] of Object.entries(envMap)) {
      if (key.toLowerCase() === lower || key.toLowerCase().includes(lower)) {
        return { token: val.trim(), resolvedProject: key, source: "env_map" };
      }
    }

    // 3. Lookup in Cloudflare KV
    if (kv) {
      const kvToken = await getProjectTokenFromKV(kv, trimmed);
      if (kvToken) {
        return { token: kvToken.trim(), resolvedProject: trimmed, source: "kv" };
      }
    }
  }

  // 4. Fallback to operator default CLARITY_API_TOKEN
  if (defaultToken && defaultToken.trim()) {
    return {
      token: defaultToken.trim(),
      resolvedProject: projectArg || "default",
      source: "default",
    };
  }

  // If only 1 project is configured in envMap and no project was specified, auto-use it
  const envKeys = Object.keys(envMap);
  if (!projectArg && envKeys.length === 1) {
    const single = envKeys[0];
    return { token: envMap[single].trim(), resolvedProject: single, source: "env_map" };
  }

  const { allProjects } = await listAllClarityProjects(envProjectsJson, defaultToken, kv);
  const hint =
    allProjects.length > 0
      ? `Configured projects: [${allProjects.join(", ")}].`
      : `No projects configured yet.`;

  throw new Error(
    `No Microsoft Clarity API token found for project "${projectArg || "unspecified"}". ${hint} Specify a valid project name or pass 'apiToken' directly.`,
  );
}

/**
 * Analyze Clarity metrics to summarize UX friction points (Rage clicks, Dead clicks, Quick backs, Excessive scroll).
 */
export function summarizeUxFriction(metrics: ClarityMetricResult[]): {
  summary: {
    totalSessions?: number;
    totalBotSessions?: number;
    rageClicks?: number;
    deadClicks?: number;
    excessiveScrolls?: number;
    quickBacks?: number;
    frictionScore: number;
    frictionRating: "Low" | "Moderate" | "High" | "Severe";
  };
  topFrictionAreas: Array<{
    dimension: string;
    value: string;
    rageClicks?: number;
    deadClicks?: number;
    quickBacks?: number;
  }>;
} {
  let totalSessions = 0;
  let totalBotSessions = 0;
  let rageClicks = 0;
  let deadClicks = 0;
  let excessiveScrolls = 0;
  let quickBacks = 0;

  const areaMap: Record<string, { dimension: string; value: string; rageClicks: number; deadClicks: number; quickBacks: number }> = {};

  for (const metric of metrics) {
    const name = metric.metricName.toLowerCase();
    for (const info of metric.information || []) {
      const sessions = Number(info.totalSessionCount || 0);
      const bots = Number(info.totalBotSessionCount || 0);
      if (sessions > 0) totalSessions += sessions;
      if (bots > 0) totalBotSessions += bots;

      // Extract dimension key and value
      const dimensionEntry = Object.entries(info).find(
        ([k]) => !k.startsWith("total") && !k.startsWith("distinct") && !k.startsWith("pages") && k !== "information",
      );
      const dimensionKey = dimensionEntry ? dimensionEntry[0] : "All";
      const dimensionVal = dimensionEntry ? String(dimensionEntry[1]) : "Total";
      const mapKey = `${dimensionKey}:${dimensionVal}`;

      if (!areaMap[mapKey]) {
        areaMap[mapKey] = { dimension: dimensionKey, value: dimensionVal, rageClicks: 0, deadClicks: 0, quickBacks: 0 };
      }

      if (name.includes("rage")) {
        const count = Number(info.totalSessionCount || 1);
        rageClicks += count;
        areaMap[mapKey].rageClicks += count;
      } else if (name.includes("dead")) {
        const count = Number(info.totalSessionCount || 1);
        deadClicks += count;
        areaMap[mapKey].deadClicks += count;
      } else if (name.includes("scroll") && name.includes("excess")) {
        const count = Number(info.totalSessionCount || 1);
        excessiveScrolls += count;
      } else if (name.includes("quick") || name.includes("back")) {
        const count = Number(info.totalSessionCount || 1);
        quickBacks += count;
        areaMap[mapKey].quickBacks += count;
      }
    }
  }

  // Calculate friction score (0 to 100)
  const baseSessions = Math.max(totalSessions, 1);
  const frictionRate = ((rageClicks * 3 + deadClicks * 1.5 + quickBacks * 2 + excessiveScrolls) / baseSessions) * 100;
  const normalizedScore = Math.min(100, Math.round(frictionRate));

  let frictionRating: "Low" | "Moderate" | "High" | "Severe" = "Low";
  if (normalizedScore > 50) frictionRating = "Severe";
  else if (normalizedScore > 25) frictionRating = "High";
  else if (normalizedScore > 10) frictionRating = "Moderate";

  const topFrictionAreas = Object.values(areaMap)
    .filter((a) => a.rageClicks > 0 || a.deadClicks > 0 || a.quickBacks > 0)
    .sort((a, b) => (b.rageClicks * 2 + b.deadClicks) - (a.rageClicks * 2 + a.deadClicks))
    .slice(0, 10);

  return {
    summary: {
      totalSessions,
      totalBotSessions,
      rageClicks,
      deadClicks,
      excessiveScrolls,
      quickBacks,
      frictionScore: normalizedScore,
      frictionRating,
    },
    topFrictionAreas,
  };
}
