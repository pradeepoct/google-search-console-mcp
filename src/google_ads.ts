/**
 * Google Ads API (v19) REST wrapper for Keyword Planner & Traffic Metrics.
 * https://developers.google.com/google-ads/api/rest/reference/rest/v19/customers/generateKeywordHistoricalMetrics
 * https://developers.google.com/google-ads/api/rest/reference/rest/v19/customers/generateKeywordIdeas
 */

const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v19";

export interface GoogleAdsApiOptions {
  token: string;
  developerToken: string;
  loginCustomerId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function cleanCustomerId(customerId: string): string {
  return customerId.trim().replace(/^customers\//, "").replace(/-/g, "");
}

const COMMON_GEO_MAP: Record<string, string> = {
  US: "geoTargetConstants/2840",
  USA: "geoTargetConstants/2840",
  UNITED_STATES: "geoTargetConstants/2840",
  IN: "geoTargetConstants/2356",
  IND: "geoTargetConstants/2356",
  INDIA: "geoTargetConstants/2356",
  GB: "geoTargetConstants/2826",
  UK: "geoTargetConstants/2826",
  UNITED_KINGDOM: "geoTargetConstants/2826",
  CA: "geoTargetConstants/2124",
  CANADA: "geoTargetConstants/2124",
  AU: "geoTargetConstants/2036",
  AUSTRALIA: "geoTargetConstants/2036",
  DE: "geoTargetConstants/2276",
  GERMANY: "geoTargetConstants/2276",
  FR: "geoTargetConstants/2250",
  FRANCE: "geoTargetConstants/2250",
  ES: "geoTargetConstants/2724",
  SPAIN: "geoTargetConstants/2724",
  IT: "geoTargetConstants/2380",
  ITALY: "geoTargetConstants/2380",
  BR: "geoTargetConstants/2076",
  BRAZIL: "geoTargetConstants/2076",
  JP: "geoTargetConstants/2392",
  JAPAN: "geoTargetConstants/2392",
};

const COMMON_LANG_MAP: Record<string, string> = {
  en: "languageConstants/1000",
  english: "languageConstants/1000",
  es: "languageConstants/1003",
  spanish: "languageConstants/1003",
  fr: "languageConstants/1002",
  french: "languageConstants/1002",
  de: "languageConstants/1001",
  german: "languageConstants/1001",
  it: "languageConstants/1004",
  italian: "languageConstants/1004",
  pt: "languageConstants/1014",
  portuguese: "languageConstants/1014",
  ja: "languageConstants/1005",
  japanese: "languageConstants/1005",
  zh: "languageConstants/1017",
  chinese: "languageConstants/1017",
  hi: "languageConstants/1023",
  hindi: "languageConstants/1023",
};

export function resolveGeoConstant(geo: string): string {
  const clean = geo.trim();
  if (clean.startsWith("geoTargetConstants/")) return clean;
  const upper = clean.toUpperCase().replace(/\s+/g, "_");
  if (COMMON_GEO_MAP[upper]) return COMMON_GEO_MAP[upper];
  if (/^\d+$/.test(clean)) return `geoTargetConstants/${clean}`;
  return clean;
}

export function resolveLanguageConstant(lang: string): string {
  const clean = lang.trim();
  if (clean.startsWith("languageConstants/")) return clean;
  const lower = clean.toLowerCase();
  if (COMMON_LANG_MAP[lower]) return COMMON_LANG_MAP[lower];
  if (/^\d+$/.test(clean)) return `languageConstants/${clean}`;
  return clean;
}

export function microsToCurrency(micros?: string | number | null): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  const n = typeof micros === "string" ? parseFloat(micros) : micros;
  if (isNaN(n)) return undefined;
  return Math.round((n / 1_000_000) * 100) / 100;
}

async function googleAdsFetch<T>(
  url: string,
  opts: GoogleAdsApiOptions,
  init: RequestInit = {},
): Promise<T> {
  const cleanDevToken = opts.developerToken.trim();
  if (!cleanDevToken) {
    throw new Error(
      "Missing Google Ads Developer Token. Set GOOGLE_ADS_DEVELOPER_TOKEN in secrets or pass developerToken in tool arguments.",
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    "developer-token": cleanDevToken,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (opts.loginCustomerId) {
    headers["login-customer-id"] = cleanCustomerId(opts.loginCustomerId);
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      parsed = null;
    }

    const message =
      parsed?.error?.message ||
      parsed?.error?.details?.[0]?.errors?.[0]?.message ||
      errorText;

    throw new Error(`Google Ads API error (${res.status}): ${message}`);
  }

  return res.json() as Promise<T>;
}

// ── 1. List Accessible Customers ─────────────────────────────────────────────

export interface ListAccessibleCustomersResponse {
  resourceNames?: string[];
}

export async function listAccessibleCustomers(
  opts: GoogleAdsApiOptions,
): Promise<{ customerIds: string[]; resourceNames: string[] }> {
  const url = `${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`;
  const data = await googleAdsFetch<ListAccessibleCustomersResponse>(url, opts, {
    method: "GET",
  });

  const resourceNames = data.resourceNames ?? [];
  const customerIds = resourceNames.map((rn) => cleanCustomerId(rn));
  return { customerIds, resourceNames };
}

// ── 2. Get Keyword Historical Metrics (Traffic Check) ─────────────────────────

export interface MonthlySearchVolume {
  year: string;
  month: string;
  monthlySearches: string;
}

export interface RawKeywordMetrics {
  avgMonthlySearches?: string;
  monthlySearchVolumes?: MonthlySearchVolume[];
  competition?: "UNSPECIFIED" | "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
  competitionIndex?: string;
  lowTopOfPageBidMicros?: string;
  highTopOfPageBidMicros?: string;
  averageCpcMicros?: string;
}

export interface RawKeywordHistoricalMetricsResult {
  text: string;
  keywordMetrics?: RawKeywordMetrics;
}

export interface GenerateKeywordHistoricalMetricsResponse {
  results?: RawKeywordHistoricalMetricsResult[];
}

export interface KeywordTrafficSummary {
  keyword: string;
  avgMonthlySearches: number;
  competition: string;
  competitionIndex: number;
  lowTopOfPageBid?: number;
  highTopOfPageBid?: number;
  averageCpc?: number;
  monthlyHistory?: Array<{
    period: string;
    searches: number;
  }>;
}

export interface GetKeywordHistoricalMetricsOptions {
  customerId: string;
  keywords: string[];
  geoTargetConstants?: string[];
  language?: string;
  keywordPlanNetwork?: "GOOGLE_SEARCH" | "GOOGLE_SEARCH_AND_PARTNERS";
  includeAdultKeywords?: boolean;
}

export async function getKeywordHistoricalMetrics(
  opts: GoogleAdsApiOptions,
  params: GetKeywordHistoricalMetricsOptions,
): Promise<{
  customerId: string;
  keywordCount: number;
  keywords: KeywordTrafficSummary[];
}> {
  const customerId = cleanCustomerId(params.customerId);
  const url = `${GOOGLE_ADS_API_BASE}/customers/${customerId}:generateKeywordHistoricalMetrics`;

  const body: Record<string, unknown> = {
    keywords: params.keywords,
    keywordPlanNetwork: params.keywordPlanNetwork ?? "GOOGLE_SEARCH",
    includeAdultKeywords: params.includeAdultKeywords ?? false,
    historicalMetricsOptions: {
      includeAverageCpc: true,
    },
  };

  if (params.geoTargetConstants && params.geoTargetConstants.length > 0) {
    body.geoTargetConstants = params.geoTargetConstants.map(resolveGeoConstant);
  }

  if (params.language) {
    body.language = resolveLanguageConstant(params.language);
  }

  const response =
    await googleAdsFetch<GenerateKeywordHistoricalMetricsResponse>(url, opts, {
      method: "POST",
      body: JSON.stringify(body),
    });

  const keywords: KeywordTrafficSummary[] = (response.results ?? []).map((r) => {
    const m = r.keywordMetrics;
    const avgSearches = m?.avgMonthlySearches ? parseInt(m.avgMonthlySearches, 10) : 0;
    const compIdx = m?.competitionIndex ? parseInt(m.competitionIndex, 10) : 0;

    const monthlyHistory = (m?.monthlySearchVolumes ?? []).map((v) => ({
      period: `${v.year}-${v.month}`,
      searches: parseInt(v.monthlySearches || "0", 10),
    }));

    return {
      keyword: r.text,
      avgMonthlySearches: avgSearches,
      competition: m?.competition ?? "UNSPECIFIED",
      competitionIndex: compIdx,
      lowTopOfPageBid: microsToCurrency(m?.lowTopOfPageBidMicros),
      highTopOfPageBid: microsToCurrency(m?.highTopOfPageBidMicros),
      averageCpc: microsToCurrency(m?.averageCpcMicros),
      monthlyHistory: monthlyHistory.length > 0 ? monthlyHistory : undefined,
    };
  });

  return {
    customerId,
    keywordCount: keywords.length,
    keywords,
  };
}

// ── 3. Generate Keyword Ideas (Keyword Discovery & Traffic) ───────────────────

export interface RawKeywordIdeaResult {
  text: string;
  keywordIdeaMetrics?: RawKeywordMetrics;
  keywordAnnotations?: {
    concepts?: Array<{
      name?: string;
      conceptGroup?: { name?: string; type?: string };
    }>;
  };
}

export interface GenerateKeywordIdeasResponse {
  results?: RawKeywordIdeaResult[];
  nextPageToken?: string;
  totalSize?: string;
}

export interface GenerateKeywordIdeasOptions {
  customerId: string;
  keywords?: string[];
  url?: string;
  site?: string;
  geoTargetConstants?: string[];
  language?: string;
  keywordPlanNetwork?: "GOOGLE_SEARCH" | "GOOGLE_SEARCH_AND_PARTNERS";
  includeAdultKeywords?: boolean;
  pageSize?: number;
  pageToken?: string;
}

export interface KeywordIdeaSummary {
  keyword: string;
  avgMonthlySearches: number;
  competition: string;
  competitionIndex: number;
  lowTopOfPageBid?: number;
  highTopOfPageBid?: number;
  averageCpc?: number;
  monthlyHistory?: Array<{
    period: string;
    searches: number;
  }>;
  concepts?: string[];
}

export async function generateKeywordIdeas(
  opts: GoogleAdsApiOptions,
  params: GenerateKeywordIdeasOptions,
): Promise<{
  customerId: string;
  totalIdeas: number;
  nextPageToken?: string;
  ideas: KeywordIdeaSummary[];
}> {
  const customerId = cleanCustomerId(params.customerId);
  const url = `${GOOGLE_ADS_API_BASE}/customers/${customerId}:generateKeywordIdeas`;

  const body: Record<string, unknown> = {
    keywordPlanNetwork: params.keywordPlanNetwork ?? "GOOGLE_SEARCH",
    includeAdultKeywords: params.includeAdultKeywords ?? false,
    pageSize: params.pageSize ?? 50,
    historicalMetricsOptions: {
      includeAverageCpc: true,
    },
  };

  if (params.pageToken) {
    body.pageToken = params.pageToken;
  }

  // Determine seed structure
  const hasKeywords = params.keywords && params.keywords.length > 0;
  const hasUrl = Boolean(params.url && params.url.trim());
  const hasSite = Boolean(params.site && params.site.trim());

  if (hasKeywords && hasUrl) {
    body.keywordAndUrlSeed = {
      keywords: params.keywords,
      url: params.url,
    };
  } else if (hasKeywords) {
    body.keywordSeed = {
      keywords: params.keywords,
    };
  } else if (hasUrl) {
    body.urlSeed = {
      url: params.url,
    };
  } else if (hasSite) {
    body.siteSeed = {
      site: params.site,
    };
  } else {
    throw new Error(
      "You must provide at least one seed: 'keywords' (list of seed keywords), 'url' (landing page URL), or 'site' (domain name).",
    );
  }

  if (params.geoTargetConstants && params.geoTargetConstants.length > 0) {
    body.geoTargetConstants = params.geoTargetConstants.map(resolveGeoConstant);
  }

  if (params.language) {
    body.language = resolveLanguageConstant(params.language);
  }

  const response = await googleAdsFetch<GenerateKeywordIdeasResponse>(url, opts, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const ideas: KeywordIdeaSummary[] = (response.results ?? []).map((r) => {
    const m = r.keywordIdeaMetrics;
    const avgSearches = m?.avgMonthlySearches ? parseInt(m.avgMonthlySearches, 10) : 0;
    const compIdx = m?.competitionIndex ? parseInt(m.competitionIndex, 10) : 0;

    const monthlyHistory = (m?.monthlySearchVolumes ?? []).map((v) => ({
      period: `${v.year}-${v.month}`,
      searches: parseInt(v.monthlySearches || "0", 10),
    }));

    const concepts = (r.keywordAnnotations?.concepts ?? [])
      .map((c) => c.name)
      .filter((n): n is string => Boolean(n));

    return {
      keyword: r.text,
      avgMonthlySearches: avgSearches,
      competition: m?.competition ?? "UNSPECIFIED",
      competitionIndex: compIdx,
      lowTopOfPageBid: microsToCurrency(m?.lowTopOfPageBidMicros),
      highTopOfPageBid: microsToCurrency(m?.highTopOfPageBidMicros),
      averageCpc: microsToCurrency(m?.averageCpcMicros),
      monthlyHistory: monthlyHistory.length > 0 ? monthlyHistory : undefined,
      concepts: concepts.length > 0 ? concepts : undefined,
    };
  });

  return {
    customerId,
    totalIdeas: ideas.length,
    nextPageToken: response.nextPageToken,
    ideas,
  };
}
