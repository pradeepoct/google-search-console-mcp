/**
 * Google SERP, AI Overview, and Competition Analysis module.
 *
 * Supports dual-engine hybrid architecture:
 *   1. SerpApi (Primary): Utilizes recurring 250 free searches/month.
 *   2. Serper.dev (Secondary Fallback): Automatically engages if SerpApi
 *      reaches its quota limit (429 / out of searches) or is unconfigured.
 */

export interface AiOverviewSource {
  title?: string;
  link?: string;
}

export interface AiOverviewData {
  present: boolean;
  snippet?: string;
  text?: string;
  sources?: AiOverviewSource[];
  raw?: unknown;
}

export interface FeaturedSnippetData {
  present: boolean;
  title?: string;
  snippet?: string;
  link?: string;
}

export interface KnowledgeGraphData {
  present: boolean;
  title?: string;
  type?: string;
  description?: string;
}

export interface OrganicRanking {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet?: string;
  date?: string;
}

export interface PeopleAlsoAskItem {
  question: string;
  snippet?: string;
  title?: string;
  link?: string;
}

export interface SerpOverviewResult {
  query: string;
  hasAiOverview: boolean;
  aiOverview?: AiOverviewData;
  hasFeaturedSnippet: boolean;
  featuredSnippet?: FeaturedSnippetData;
  hasKnowledgeGraph: boolean;
  knowledgeGraph?: KnowledgeGraphData;
  peopleAlsoAsk?: PeopleAlsoAskItem[];
  organicResultsCount: number;
  topOrganicResults: OrganicRanking[];
  providerUsed: "serpapi" | "serper";
  fallbackTriggered: boolean;
  fallbackReason?: string;
}

export interface SerpEngineConfig {
  serpApiKey?: string;
  serperApiKey?: string;
}

export interface CheckSerpQueryOptions {
  query: string;
  country?: string; // e.g. "us", "uk", "in"
  language?: string; // e.g. "en", "es", "fr"
  provider?: "auto" | "serpapi" | "serper";
  serpApiKey?: string;
  serperApiKey?: string;
}

export class SerpQuotaError extends Error {
  readonly provider: "serpapi" | "serper";

  constructor(message: string, provider: "serpapi" | "serper") {
    super(message);
    this.name = "SerpQuotaError";
    this.provider = provider;
  }
}

export function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlStr;
  }
}

/**
 * Fetch SERP data from SerpApi.
 */
export async function fetchSerpApi(
  query: string,
  country = "us",
  language = "en",
  apiKey: string,
): Promise<Omit<SerpOverviewResult, "providerUsed" | "fallbackTriggered" | "fallbackReason">> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", country);
  url.searchParams.set("hl", language);
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (response.status === 429) {
    throw new SerpQuotaError("SerpApi quota limit reached (HTTP 429).", "serpapi");
  }

  const raw = await response.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`SerpApi invalid JSON response (${response.status}): ${raw.slice(0, 200)}`);
  }

  if (!response.ok || data.error) {
    const errorMsg = data.error || `HTTP ${response.status}: ${raw.slice(0, 200)}`;
    if (
      typeof errorMsg === "string" &&
      (errorMsg.toLowerCase().includes("run out of searches") ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("limit") ||
        response.status === 429)
    ) {
      throw new SerpQuotaError(errorMsg, "serpapi");
    }
    throw new Error(`SerpApi error: ${errorMsg}`);
  }

  // Parse AI Overview
  const rawAi = data.ai_overview;
  const hasAiOverview = Boolean(rawAi);
  let aiOverview: AiOverviewData | undefined;

  if (hasAiOverview) {
    let combinedText = "";
    if (typeof rawAi.snippet === "string") {
      combinedText = rawAi.snippet;
    } else if (Array.isArray(rawAi.text_blocks)) {
      combinedText = rawAi.text_blocks
        .map((b: any) => b.snippet || b.title || "")
        .filter(Boolean)
        .join("\n\n");
    }

    const sources: AiOverviewSource[] = [];
    if (Array.isArray(rawAi.sources)) {
      for (const s of rawAi.sources) {
        if (s.link || s.title) {
          sources.push({ title: s.title, link: s.link });
        }
      }
    }

    aiOverview = {
      present: true,
      snippet: rawAi.snippet,
      text: combinedText || rawAi.snippet,
      sources: sources.length ? sources : undefined,
    };
  }

  // Parse Answer Box / Featured Snippet
  const rawAnswerBox = data.answer_box;
  const hasFeaturedSnippet = Boolean(rawAnswerBox);
  let featuredSnippet: FeaturedSnippetData | undefined;

  if (hasFeaturedSnippet) {
    featuredSnippet = {
      present: true,
      title: rawAnswerBox.title,
      snippet: rawAnswerBox.snippet || rawAnswerBox.answer,
      link: rawAnswerBox.link,
    };
  }

  // Parse Knowledge Graph
  const rawKg = data.knowledge_graph;
  const hasKnowledgeGraph = Boolean(rawKg);
  let knowledgeGraph: KnowledgeGraphData | undefined;

  if (hasKnowledgeGraph) {
    knowledgeGraph = {
      present: true,
      title: rawKg.title,
      type: rawKg.type,
      description: rawKg.description,
    };
  }

  // Parse People Also Ask
  const peopleAlsoAsk: PeopleAlsoAskItem[] = [];
  if (Array.isArray(data.related_questions)) {
    for (const item of data.related_questions) {
      if (item.question) {
        peopleAlsoAsk.push({
          question: item.question,
          snippet: item.snippet,
          title: item.title,
          link: item.link,
        });
      }
    }
  }

  // Parse Organic Results
  const organicList: OrganicRanking[] = [];
  if (Array.isArray(data.organic_results)) {
    for (const item of data.organic_results) {
      if (item.title && item.link) {
        organicList.push({
          position: item.position ?? organicList.length + 1,
          title: item.title,
          link: item.link,
          domain: extractDomain(item.link),
          snippet: item.snippet,
          date: item.date,
        });
      }
    }
  }

  return {
    query,
    hasAiOverview,
    aiOverview,
    hasFeaturedSnippet,
    featuredSnippet,
    hasKnowledgeGraph,
    knowledgeGraph,
    peopleAlsoAsk: peopleAlsoAsk.length > 0 ? peopleAlsoAsk : undefined,
    organicResultsCount: organicList.length,
    topOrganicResults: organicList.slice(0, 10),
  };
}

/**
 * Fetch SERP data from Serper.dev.
 */
export async function fetchSerperDev(
  query: string,
  country = "us",
  language = "en",
  apiKey: string,
): Promise<Omit<SerpOverviewResult, "providerUsed" | "fallbackTriggered" | "fallbackReason">> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: country,
      hl: language,
    }),
  });

  if (response.status === 429) {
    throw new SerpQuotaError("Serper.dev quota limit reached (HTTP 429).", "serper");
  }

  const raw = await response.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Serper.dev invalid JSON response (${response.status}): ${raw.slice(0, 200)}`);
  }

  if (!response.ok || (data.statusCode && data.statusCode !== 200) || data.message) {
    const errorMsg = data.message || `HTTP ${response.status}: ${raw.slice(0, 200)}`;
    if (
      typeof errorMsg === "string" &&
      (errorMsg.toLowerCase().includes("credit") ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("unauthorized") ||
        response.status === 429)
    ) {
      throw new SerpQuotaError(errorMsg, "serper");
    }
    throw new Error(`Serper.dev error: ${errorMsg}`);
  }

  // Parse AI Overview
  const rawAi = data.aiOverview;
  const hasAiOverview = Boolean(rawAi);
  let aiOverview: AiOverviewData | undefined;

  if (hasAiOverview) {
    const sources: AiOverviewSource[] = [];
    if (Array.isArray(rawAi.sources)) {
      for (const s of rawAi.sources) {
        if (s.link || s.title) {
          sources.push({ title: s.title, link: s.link });
        }
      }
    }

    aiOverview = {
      present: true,
      snippet: rawAi.snippet,
      text: rawAi.text || rawAi.snippet,
      sources: sources.length ? sources : undefined,
    };
  }

  // Parse Answer Box / Featured Snippet
  const rawAnswerBox = data.answerBox;
  const hasFeaturedSnippet = Boolean(rawAnswerBox);
  let featuredSnippet: FeaturedSnippetData | undefined;

  if (hasFeaturedSnippet) {
    featuredSnippet = {
      present: true,
      title: rawAnswerBox.title,
      snippet: rawAnswerBox.snippet,
      link: rawAnswerBox.link,
    };
  }

  // Parse Knowledge Graph
  const rawKg = data.knowledgeGraph;
  const hasKnowledgeGraph = Boolean(rawKg);
  let knowledgeGraph: KnowledgeGraphData | undefined;

  if (hasKnowledgeGraph) {
    knowledgeGraph = {
      present: true,
      title: rawKg.title,
      type: rawKg.type,
      description: rawKg.description,
    };
  }

  // Parse People Also Ask
  const peopleAlsoAsk: PeopleAlsoAskItem[] = [];
  if (Array.isArray(data.peopleAlsoAsk)) {
    for (const item of data.peopleAlsoAsk) {
      if (item.question) {
        peopleAlsoAsk.push({
          question: item.question,
          snippet: item.snippet,
          title: item.title,
          link: item.link,
        });
      }
    }
  }

  // Parse Organic Results
  const organicList: OrganicRanking[] = [];
  if (Array.isArray(data.organic)) {
    for (const item of data.organic) {
      if (item.title && item.link) {
        organicList.push({
          position: item.position ?? organicList.length + 1,
          title: item.title,
          link: item.link,
          domain: extractDomain(item.link),
          snippet: item.snippet,
          date: item.date,
        });
      }
    }
  }

  return {
    query,
    hasAiOverview,
    aiOverview,
    hasFeaturedSnippet,
    featuredSnippet,
    hasKnowledgeGraph,
    knowledgeGraph,
    peopleAlsoAsk: peopleAlsoAsk.length > 0 ? peopleAlsoAsk : undefined,
    organicResultsCount: organicList.length,
    topOrganicResults: organicList.slice(0, 10),
  };
}

/**
 * Check a single keyword SERP and Google AI Overview with automatic hybrid fallback.
 */
export async function checkKeywordSerpOverview(
  opts: CheckSerpQueryOptions,
  envConfig: SerpEngineConfig,
): Promise<SerpOverviewResult> {
  const country = opts.country || "us";
  const language = opts.language || "en";
  const providerMode = opts.provider || "auto";

  const serpApiKey = opts.serpApiKey || envConfig.serpApiKey;
  const serperApiKey = opts.serperApiKey || envConfig.serperApiKey;

  // Case 1: Explicit SerpApi requested
  if (providerMode === "serpapi") {
    if (!serpApiKey) {
      throw new Error(
        "SERPAPI_API_KEY is required when provider='serpapi'. Set it in environment variables or pass as serpApiKey.",
      );
    }
    const result = await fetchSerpApi(opts.query, country, language, serpApiKey);
    return {
      ...result,
      providerUsed: "serpapi",
      fallbackTriggered: false,
    };
  }

  // Case 2: Explicit Serper.dev requested
  if (providerMode === "serper") {
    if (!serperApiKey) {
      throw new Error(
        "SERPER_API_KEY is required when provider='serper'. Set it in environment variables or pass as serperApiKey.",
      );
    }
    const result = await fetchSerperDev(opts.query, country, language, serperApiKey);
    return {
      ...result,
      providerUsed: "serper",
      fallbackTriggered: false,
    };
  }

  // Case 3: "auto" mode with hybrid fallback (SerpApi first -> fallback to Serper.dev)
  if (serpApiKey) {
    try {
      const result = await fetchSerpApi(opts.query, country, language, serpApiKey);
      return {
        ...result,
        providerUsed: "serpapi",
        fallbackTriggered: false,
      };
    } catch (err: any) {
      const isQuotaOrLimit =
        err instanceof SerpQuotaError ||
        (err?.message && /quota|limit|429|run out/i.test(err.message));

      if (isQuotaOrLimit && serperApiKey) {
        // Automatically switch to Serper.dev
        const fallbackResult = await fetchSerperDev(
          opts.query,
          country,
          language,
          serperApiKey,
        );
        return {
          ...fallbackResult,
          providerUsed: "serper",
          fallbackTriggered: true,
          fallbackReason: `SerpApi failed (${err.message}). Seamlessly switched to Serper.dev fallback.`,
        };
      }

      // If not a quota error or Serper key not available, rethrow or try Serper if configured
      if (serperApiKey) {
        try {
          const fallbackResult = await fetchSerperDev(
            opts.query,
            country,
            language,
            serperApiKey,
          );
          return {
            ...fallbackResult,
            providerUsed: "serper",
            fallbackTriggered: true,
            fallbackReason: `SerpApi failed (${err.message}). Seamlessly switched to Serper.dev fallback.`,
          };
        } catch {
          throw err;
        }
      }

      throw err;
    }
  }

  // If no SerpApi key, check if Serper.dev key is configured
  if (serperApiKey) {
    const result = await fetchSerperDev(opts.query, country, language, serperApiKey);
    return {
      ...result,
      providerUsed: "serper",
      fallbackTriggered: false,
    };
  }

  throw new Error(
    "No SERP API key configured. Provide either SERPAPI_API_KEY (SerpApi) or SERPER_API_KEY (Serper.dev) in Worker secrets or tool parameters.",
  );
}

/**
 * Check multiple keywords in parallel with bounded concurrency.
 */
export async function checkBatchSerpOverview(
  keywords: string[],
  options: Omit<CheckSerpQueryOptions, "query">,
  envConfig: SerpEngineConfig,
  concurrency = 3,
): Promise<SerpOverviewResult[]> {
  const results: SerpOverviewResult[] = [];
  const queue = [...keywords];

  async function worker() {
    while (queue.length > 0) {
      const keyword = queue.shift();
      if (!keyword) break;
      const res = await checkKeywordSerpOverview(
        { ...options, query: keyword },
        envConfig,
      );
      results.push(res);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, keywords.length) },
    () => worker(),
  );
  await Promise.all(workers);

  // Preserve initial keywords order
  const orderMap = new Map(keywords.map((k, i) => [k.toLowerCase(), i]));
  return results.sort(
    (a, b) =>
      (orderMap.get(a.query.toLowerCase()) ?? 0) -
      (orderMap.get(b.query.toLowerCase()) ?? 0),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SERP Competition & Ranking Opportunity Analyzer
// ────────────────────────────────────────────────────────────────────────────

const UGC_DOMAINS = new Set([
  "reddit.com",
  "quora.com",
  "medium.com",
  "linkedin.com",
  "pinterest.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "threads.net",
  "stackoverflow.com",
  "tiktok.com",
  "instagram.com",
]);

const AUTHORITY_DOMAINS = new Set([
  "wikipedia.org",
  "amazon.com",
  "youtube.com",
  "apple.com",
  "microsoft.com",
  "google.com",
  "nih.gov",
  "cdc.gov",
  "gov",
  "edu",
]);

export interface KeywordCompetitionAnalysis {
  keyword: string;
  country: string;
  language: string;
  providerUsed: "serpapi" | "serper";
  serpFeatures: {
    hasAiOverview: boolean;
    hasFeaturedSnippet: boolean;
    hasKnowledgeGraph: boolean;
  };
  totalOrganicRankings: number;
  uniqueDomainsCount: number;
  competitorsTop10: Array<{
    position: number;
    domain: string;
    title: string;
    link: string;
    snippet?: string;
    isUGC: boolean;
    isMajorAuthority: boolean;
  }>;
  signals: {
    ugcDomainsInTop10: string[];
    majorAuthoritiesInTop10: string[];
    dominantDomains: string[];
  };
  opportunityScore: "High Opportunity" | "Moderate Opportunity" | "High Difficulty";
  opportunitySummary: string;
}

export async function analyzeKeywordCompetition(
  opts: CheckSerpQueryOptions,
  envConfig: SerpEngineConfig,
): Promise<KeywordCompetitionAnalysis> {
  const serp = await checkKeywordSerpOverview(opts, envConfig);
  const country = opts.country || "us";
  const language = opts.language || "en";

  const domainCounts = new Map<string, number>();
  const ugcFound: string[] = [];
  const authFound: string[] = [];

  const competitorsTop10 = serp.topOrganicResults.map((item) => {
    const domain = item.domain || extractDomain(item.link);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);

    const isUGC =
      UGC_DOMAINS.has(domain) ||
      domain.includes("forum") ||
      domain.includes("community") ||
      domain.includes("discuss");

    const isMajorAuthority =
      AUTHORITY_DOMAINS.has(domain) ||
      domain.endsWith(".gov") ||
      domain.endsWith(".edu");

    if (isUGC && !ugcFound.includes(domain)) ugcFound.push(domain);
    if (isMajorAuthority && !authFound.includes(domain)) authFound.push(domain);

    return {
      position: item.position,
      domain,
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      isUGC,
      isMajorAuthority,
    };
  });

  const dominantDomains = Array.from(domainCounts.entries())
    .filter(([_, count]) => count > 1)
    .map(([dom]) => dom);

  // Determine Opportunity Score
  let opportunityScore: "High Opportunity" | "Moderate Opportunity" | "High Difficulty";
  let opportunitySummary = "";

  const top3HasUgc = competitorsTop10.slice(0, 3).some((c) => c.isUGC);
  const top3HasAuthority = competitorsTop10.slice(0, 3).some((c) => c.isMajorAuthority);

  if (top3HasUgc || ugcFound.length >= 2) {
    opportunityScore = "High Opportunity";
    opportunitySummary = `Strong ranking opportunity: Forum/UGC discussions (${ugcFound.join(", ")}) rank on page 1, indicating Google is rewarding experiential content and authoritative niche guides can outrank them.`;
  } else if (top3HasAuthority && authFound.length >= 3) {
    opportunityScore = "High Difficulty";
    opportunitySummary = `Competitive SERP: Dominated by major authority/institutional domains (${authFound.join(", ")}). Targeting long-tail variations is recommended.`;
  } else {
    opportunityScore = "Moderate Opportunity";
    opportunitySummary = `Moderate ranking difficulty with ${competitorsTop10.length} standard niche competitors in top 10. Direct rankings are achievable with targeted comprehensive content.`;
  }

  return {
    keyword: opts.query,
    country,
    language,
    providerUsed: serp.providerUsed,
    serpFeatures: {
      hasAiOverview: serp.hasAiOverview,
      hasFeaturedSnippet: serp.hasFeaturedSnippet,
      hasKnowledgeGraph: serp.hasKnowledgeGraph,
    },
    totalOrganicRankings: serp.organicResultsCount,
    uniqueDomainsCount: domainCounts.size,
    competitorsTop10,
    signals: {
      ugcDomainsInTop10: ugcFound,
      majorAuthoritiesInTop10: authFound,
      dominantDomains,
    },
    opportunityScore,
    opportunitySummary,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-Factor Keyword Difficulty (KD) Engine
// ────────────────────────────────────────────────────────────────────────────

const MEGA_AUTHORITIES = new Set([
  "wikipedia.org",
  "amazon.com",
  "apple.com",
  "microsoft.com",
  "google.com",
  "youtube.com",
  "nytimes.com",
  "forbes.com",
  "healthline.com",
  "webmd.com",
  "mayoclinic.org",
  "investopedia.com",
  "hubspot.com",
  "yelp.com",
  "tripadvisor.com",
  "g2.com",
  "trustpilot.com",
  "cnet.com",
  "bbb.org",
  "nih.gov",
  "cdc.gov",
  "who.int",
  "usnews.com",
  "harvard.edu",
  "stanford.edu",
  "mit.edu",
]);

const HIGH_AUTHORITIES = new Set([
  "techradar.com",
  "pcmag.com",
  "theverge.com",
  "nerdwallet.com",
  "businessinsider.com",
  "wired.com",
  "shopify.com",
  "zapier.com",
  "salesforce.com",
  "searchenginejournal.com",
  "searchengineland.com",
  "moz.com",
  "semrush.com",
  "ahrefs.com",
  "backlinko.com",
  "digitaltrends.com",
  "tomsguide.com",
  "thespruce.com",
  "verywellhealth.com",
  "verywellmind.com",
  "thebalance.com",
  "bloomberg.com",
  "wsj.com",
  "washingtonpost.com",
  "theguardian.com",
  "bbc.com",
  "cnn.com",
]);

export interface CompetitorEvaluation {
  position: number;
  domain: string;
  title: string;
  link: string;
  snippet?: string;
  domainTier: "Mega Authority" | "High Authority" | "User Generated Content" | "Standard / Niche";
  estimatedAuthorityScore: number;
  hasExactKeywordInTitle: boolean;
  hasPartialKeywordInTitle: boolean;
}

export interface KeywordDifficultyResult {
  keyword: string;
  country: string;
  language: string;
  providerUsed: "serpapi" | "serper";
  difficultyScore: number; // 0 - 100
  difficultyRating: "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard";
  backlinkRequirements: string;
  factorScores: {
    domainAuthorityFactor: number; // 0 - 100
    onPageTitleOptimizationFactor: number; // 0 - 100
    serpFeaturesCrowdingFactor: number; // 0 - 100
  };
  serpBreakdown: {
    totalOrganicAnalyzed: number;
    megaAuthorityCount: number;
    highAuthorityCount: number;
    ugcCount: number;
    standardSitesCount: number;
    titlesWithExactKeyword: number;
    titlesWithPartialKeyword: number;
    hasAiOverview: boolean;
    hasFeaturedSnippet: boolean;
    hasKnowledgeGraph: boolean;
  };
  topCompetitors: CompetitorEvaluation[];
  opportunities: string[];
  recommendations: string[];
}

export async function checkKeywordDifficulty(
  opts: CheckSerpQueryOptions,
  envConfig: SerpEngineConfig,
): Promise<KeywordDifficultyResult> {
  const serp = await checkKeywordSerpOverview(opts, envConfig);
  const country = opts.country || "us";
  const language = opts.language || "en";
  const keyword = opts.query.trim();

  const kwTerms = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let weightedAuthoritySum = 0;
  let totalWeight = 0;

  let megaCount = 0;
  let highCount = 0;
  let ugcCount = 0;
  let standardCount = 0;

  let exactTitleCount = 0;
  let partialTitleCount = 0;
  const ugcDomainsList: string[] = [];

  const topCompetitors: CompetitorEvaluation[] = serp.topOrganicResults.map((item) => {
    const domain = item.domain || extractDomain(item.link);
    const isGovOrEdu = domain.endsWith(".gov") || domain.endsWith(".edu");
    const isMega = isGovOrEdu || MEGA_AUTHORITIES.has(domain);
    const isHigh = !isMega && HIGH_AUTHORITIES.has(domain);
    const isUgc =
      UGC_DOMAINS.has(domain) ||
      domain.includes("forum") ||
      domain.includes("discuss") ||
      domain.includes("community");

    let domainTier: CompetitorEvaluation["domainTier"];
    let estimatedAuthorityScore = 45;

    if (isMega) {
      domainTier = "Mega Authority";
      estimatedAuthorityScore = 95;
      megaCount++;
    } else if (isHigh) {
      domainTier = "High Authority";
      estimatedAuthorityScore = 75;
      highCount++;
    } else if (isUgc) {
      domainTier = "User Generated Content";
      estimatedAuthorityScore = 20;
      ugcCount++;
      if (!ugcDomainsList.includes(domain)) ugcDomainsList.push(domain);
    } else {
      domainTier = "Standard / Niche";
      estimatedAuthorityScore = 45;
      standardCount++;
    }

    const titleLower = item.title.toLowerCase();
    const hasExactKeywordInTitle = titleLower.includes(keyword.toLowerCase());
    const hasPartialKeywordInTitle =
      !hasExactKeywordInTitle &&
      kwTerms.length > 0 &&
      kwTerms.every((t) => titleLower.includes(t));

    if (hasExactKeywordInTitle) {
      exactTitleCount++;
    } else if (hasPartialKeywordInTitle) {
      partialTitleCount++;
    }

    // Position weighting: top 3 results represent 50%+ of all SERP clicks
    const posWeight = item.position <= 3 ? 1.6 : item.position <= 6 ? 1.0 : 0.6;
    weightedAuthoritySum += estimatedAuthorityScore * posWeight;
    totalWeight += posWeight;

    return {
      position: item.position,
      domain,
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      domainTier,
      estimatedAuthorityScore,
      hasExactKeywordInTitle,
      hasPartialKeywordInTitle,
    };
  });

  // Calculate Factor Scores
  const domainAuthorityFactor =
    totalWeight > 0
      ? Math.min(100, Math.round(weightedAuthoritySum / totalWeight))
      : 40;

  const totalResults = Math.max(1, topCompetitors.length);
  const onPageTitleOptimizationFactor = Math.min(
    100,
    Math.round((exactTitleCount * 12 + partialTitleCount * 5) * (10 / totalResults)),
  );

  let serpFeaturesCrowdingFactor = 15;
  if (serp.hasAiOverview) serpFeaturesCrowdingFactor += 35;
  if (serp.hasFeaturedSnippet) serpFeaturesCrowdingFactor += 30;
  if (serp.hasKnowledgeGraph) serpFeaturesCrowdingFactor += 20;
  serpFeaturesCrowdingFactor = Math.min(100, serpFeaturesCrowdingFactor);

  // Compute composite score
  let rawScore =
    domainAuthorityFactor * 0.55 +
    onPageTitleOptimizationFactor * 0.3 +
    serpFeaturesCrowdingFactor * 0.15;

  // Modifiers:
  const top3HasUgc = topCompetitors.slice(0, 3).some((c) => c.domainTier === "User Generated Content");
  if (top3HasUgc) {
    rawScore -= 12; // Massive opportunity: Google is filling top 3 with forum discussions
  }
  if (ugcCount >= 2) {
    rawScore -= 8;
  }
  if (megaCount >= 4) {
    rawScore += 10;
  }
  if (exactTitleCount === 0) {
    rawScore -= 10; // None of the competitors have targeted this keyword in title
  }

  const difficultyScore = Math.min(99, Math.max(1, Math.round(rawScore)));

  // Difficulty Bracket & Backlink Guidance
  let difficultyRating: KeywordDifficultyResult["difficultyRating"];
  let backlinkRequirements = "";

  if (difficultyScore <= 25) {
    difficultyRating = "Very Easy";
    backlinkRequirements =
      "0 – 2 referring domains needed. You can rank with a well-structured, highly relevant page alone.";
  } else if (difficultyScore <= 45) {
    difficultyRating = "Easy";
    backlinkRequirements =
      "2 – 8 quality referring domains needed. Highly achievable for newer or niche websites.";
  } else if (difficultyScore <= 65) {
    difficultyRating = "Medium";
    backlinkRequirements =
      "8 – 25 quality referring domains needed. Requires solid on-page SEO and established topical relevance.";
  } else if (difficultyScore <= 80) {
    difficultyRating = "Hard";
    backlinkRequirements =
      "25 – 60+ high-authority referring domains needed. Dominated by established industry leaders.";
  } else {
    difficultyRating = "Very Hard";
    backlinkRequirements =
      "60 – 150+ high-DA referring domains needed. Dominated by global brand authorities, institutional, or government sites.";
  }

  // Generate Smart Opportunities & Recommendations
  const opportunities: string[] = [];
  const recommendations: string[] = [];

  if (ugcCount > 0) {
    opportunities.push(
      `UGC/Community Discussions in Top 10: ${ugcDomainsList.join(", ")} ranks on page 1. This signals that Google is rewarding experiential answers due to a shortage of dedicated authoritative guides.`,
    );
  }

  if (exactTitleCount <= 3) {
    opportunities.push(
      `Weak Competitor Title Targeting: Only ${exactTitleCount} of the top ${topCompetitors.length} competitors have the exact keyword in their <title> tag. Using an exact-match title gives you an immediate on-page advantage.`,
    );
  }

  if (serp.hasAiOverview) {
    recommendations.push(
      "Google AI Overview Present: Incorporate clear definitions, concise summary callouts, and comparison tables so Google can cite your page in the AI Overview.",
    );
  }

  if (serp.hasFeaturedSnippet) {
    recommendations.push(
      "Featured Snippet Present: Target the 'position 0' snippet by answering the core query in a concise 40-50 word paragraph directly below your H2 heading.",
    );
  }

  if (difficultyScore <= 45) {
    recommendations.push(
      "High Ranking Potential: Prioritize publishing a comprehensive 1,500+ word resource with original insights, screenshots/tables, and clear headings.",
    );
  } else if (difficultyScore >= 66) {
    recommendations.push(
      "High Competition Warning: Instead of targeting this head term directly, publish 3-5 supporting long-tail articles first, then link them to a pillar page targeting this topic.",
    );
  } else {
    recommendations.push(
      "Moderate Difficulty: Ensure complete search intent coverage, earn a few relevant niche backlinks, and maintain strong internal linking from related pages.",
    );
  }

  return {
    keyword: opts.query,
    country,
    language,
    providerUsed: serp.providerUsed,
    difficultyScore,
    difficultyRating,
    backlinkRequirements,
    factorScores: {
      domainAuthorityFactor,
      onPageTitleOptimizationFactor,
      serpFeaturesCrowdingFactor,
    },
    serpBreakdown: {
      totalOrganicAnalyzed: topCompetitors.length,
      megaAuthorityCount: megaCount,
      highAuthorityCount: highCount,
      ugcCount,
      standardSitesCount: standardCount,
      titlesWithExactKeyword: exactTitleCount,
      titlesWithPartialKeyword: partialTitleCount,
      hasAiOverview: serp.hasAiOverview,
      hasFeaturedSnippet: serp.hasFeaturedSnippet,
      hasKnowledgeGraph: serp.hasKnowledgeGraph,
    },
    topCompetitors,
    opportunities,
    recommendations,
  };
}

export async function checkBatchKeywordDifficulty(
  keywords: string[],
  options: Omit<CheckSerpQueryOptions, "query">,
  envConfig: SerpEngineConfig,
  concurrency = 3,
): Promise<KeywordDifficultyResult[]> {
  const results: KeywordDifficultyResult[] = [];
  const queue = [...keywords];

  async function worker() {
    while (queue.length > 0) {
      const keyword = queue.shift();
      if (!keyword) break;
      const res = await checkKeywordDifficulty(
        { ...options, query: keyword },
        envConfig,
      );
      results.push(res);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, keywords.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const orderMap = new Map(keywords.map((k, i) => [k.toLowerCase(), i]));
  return results.sort(
    (a, b) =>
      (orderMap.get(a.keyword.toLowerCase()) ?? 0) -
      (orderMap.get(b.keyword.toLowerCase()) ?? 0),
  );
}
