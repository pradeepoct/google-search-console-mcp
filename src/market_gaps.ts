/**
 * Market Gap & Ranking Opportunity Intelligence Engine.
 *
 * Implements:
 *   1. Reddit & Forum Content Gap Hunter (identifying keywords where user discussions rank in top 3).
 *   2. People Also Ask (PAA) Deep Tree & FAQ Schema Generator.
 *   3. Outdated Content & SERP Freshness Gap Detector.
 *   4. High-CPC / Low-KD "Golden Ratio" Opportunity Hunter.
 */

import {
  checkKeywordSerpOverview,
  checkKeywordDifficulty,
  extractDomain,
  type CheckSerpQueryOptions,
  type SerpEngineConfig,
  type PeopleAlsoAskItem,
} from "./serp";

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
  "stackexchange.com",
  "tiktok.com",
  "instagram.com",
]);

// ────────────────────────────────────────────────────────────────────────────
// 1. Reddit & Forum Content Gap Hunter
// ────────────────────────────────────────────────────────────────────────────

export interface ForumContentGapItem {
  keyword: string;
  forumDomain: string;
  forumUrl: string;
  forumTitle: string;
  forumPosition: number;
  totalCompetitorsAnalyzed: number;
  opportunityLevel: "High Opportunity (Top 3)" | "Moderate Opportunity (Top 5)";
  rankingInsight: string;
  recommendedContentFormat: string;
}

export interface ForumContentGapResult {
  totalKeywordsChecked: number;
  totalGapsFound: number;
  gaps: ForumContentGapItem[];
}

export async function findRedditForumContentGaps(
  keywords: string[],
  options: Omit<CheckSerpQueryOptions, "query">,
  envConfig: SerpEngineConfig,
  maxPosition = 5,
  concurrency = 3,
): Promise<ForumContentGapResult> {
  const gaps: ForumContentGapItem[] = [];
  const queue = [...keywords];

  async function worker() {
    while (queue.length > 0) {
      const kw = queue.shift();
      if (!kw) break;

      try {
        const serp = await checkKeywordSerpOverview(
          { ...options, query: kw },
          envConfig,
        );

        for (const item of serp.topOrganicResults) {
          if (item.position > maxPosition) continue;

          const domain = item.domain || extractDomain(item.link);
          const isUgc =
            UGC_DOMAINS.has(domain) ||
            domain.includes("forum") ||
            domain.includes("discuss") ||
            domain.includes("community");

          if (isUgc) {
            const opportunityLevel =
              item.position <= 3
                ? "High Opportunity (Top 3)"
                : "Moderate Opportunity (Top 5)";

            gaps.push({
              keyword: kw,
              forumDomain: domain,
              forumUrl: item.link,
              forumTitle: item.title,
              forumPosition: item.position,
              totalCompetitorsAnalyzed: serp.topOrganicResults.length,
              opportunityLevel,
              rankingInsight: `Google ranks a user discussion (${domain}) at position #${item.position}. This confirms search intent is underserved by dedicated editorial articles.`,
              recommendedContentFormat: `Publish an authoritative guide targeting "${kw}". Address the exact questions raised in the ${domain} thread, include concrete examples/comparisons, and structure with clear H2 headings.`,
            });
            break; // One primary gap recorded per keyword
          }
        }
      } catch {
        // Skip failed keyword silently in batch
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, keywords.length) },
    () => worker(),
  );
  await Promise.all(workers);

  // Sort by position ascending (Rank #1 gaps first)
  gaps.sort((a, b) => a.forumPosition - b.forumPosition);

  return {
    totalKeywordsChecked: keywords.length,
    totalGapsFound: gaps.length,
    gaps,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. People Also Ask (PAA) Deep Tree Extractor
// ────────────────────────────────────────────────────────────────────────────

export interface CategorizedPaaQuestion {
  question: string;
  category: "Definitions & Concepts" | "How-To & Actionable" | "Pricing & Costs" | "Comparisons & Choices" | "General / Other";
  snippet?: string;
  sourceTitle?: string;
  sourceUrl?: string;
}

export interface PaaTreeResult {
  query: string;
  country: string;
  language: string;
  totalQuestions: number;
  categorizedQuestions: CategorizedPaaQuestion[];
  faqSchemaJsonLd: string;
  recommendedH2Headings: string[];
}

export async function getPeopleAlsoAskTree(
  opts: CheckSerpQueryOptions,
  envConfig: SerpEngineConfig,
): Promise<PaaTreeResult> {
  const serp = await checkKeywordSerpOverview(opts, envConfig);
  const country = opts.country || "us";
  const language = opts.language || "en";

  const rawQuestions = serp.peopleAlsoAsk || [];

  const categorizedQuestions: CategorizedPaaQuestion[] = rawQuestions.map((q) => {
    const textLower = q.question.toLowerCase();
    let category: CategorizedPaaQuestion["category"] = "General / Other";

    if (
      textLower.startsWith("what is") ||
      textLower.startsWith("what does") ||
      textLower.startsWith("what are") ||
      textLower.includes("definition") ||
      textLower.includes("meaning")
    ) {
      category = "Definitions & Concepts";
    } else if (
      textLower.startsWith("how to") ||
      textLower.startsWith("how do") ||
      textLower.startsWith("how can") ||
      textLower.startsWith("how does") ||
      textLower.includes("steps")
    ) {
      category = "How-To & Actionable";
    } else if (
      textLower.includes("cost") ||
      textLower.includes("price") ||
      textLower.includes("how much") ||
      textLower.includes("free") ||
      textLower.includes("cheap") ||
      textLower.includes("fee")
    ) {
      category = "Pricing & Costs";
    } else if (
      textLower.includes(" vs ") ||
      textLower.includes(" or ") ||
      textLower.includes("difference") ||
      textLower.includes("better") ||
      textLower.includes("alternative")
    ) {
      category = "Comparisons & Choices";
    }

    return {
      question: q.question,
      category,
      snippet: q.snippet,
      sourceTitle: q.title,
      sourceUrl: q.link,
    };
  });

  // Build JSON-LD FAQPage schema
  const faqEntities = categorizedQuestions.map((q) => ({
    "@type": "Question",
    name: q.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: q.snippet || `Detailed answer for: ${q.question}`,
    },
  }));

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqEntities,
  };

  const recommendedH2Headings = categorizedQuestions.map(
    (q) => `H2 / H3: ${q.question}`,
  );

  return {
    query: opts.query,
    country,
    language,
    totalQuestions: categorizedQuestions.length,
    categorizedQuestions,
    faqSchemaJsonLd: JSON.stringify(faqSchema, null, 2),
    recommendedH2Headings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Outdated Content & Freshness Gap Detector
// ────────────────────────────────────────────────────────────────────────────

export interface FreshnessGapItem {
  keyword: string;
  averageAgeYears: number;
  staleCount: number; // results published <= 2023
  freshCount: number; // results published >= 2024
  freshestYearDetected?: number;
  oldestYearDetected?: number;
  freshnessOpportunity: "High Opportunity (Outdated SERP)" | "Moderate" | "Low (Consistently Fresh)";
  topCompetitorDates: Array<{
    position: number;
    title: string;
    domain: string;
    detectedDate?: string;
    detectedYear?: number;
  }>;
  actionableInsight: string;
}

export function extractYearFromText(text?: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(201[5-9]|202[0-6])\b/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

export async function detectSerpFreshnessGaps(
  keywords: string[],
  options: Omit<CheckSerpQueryOptions, "query">,
  envConfig: SerpEngineConfig,
  concurrency = 3,
): Promise<{ totalAnalyzed: number; results: FreshnessGapItem[] }> {
  const results: FreshnessGapItem[] = [];
  const queue = [...keywords];
  const currentYear = new Date().getFullYear();

  async function worker() {
    while (queue.length > 0) {
      const kw = queue.shift();
      if (!kw) break;

      try {
        const serp = await checkKeywordSerpOverview(
          { ...options, query: kw },
          envConfig,
        );

        let staleCount = 0;
        let freshCount = 0;
        const yearsFound: number[] = [];

        const competitorDates = serp.topOrganicResults.map((item) => {
          const domain = item.domain || extractDomain(item.link);
          const year =
            extractYearFromText(item.date) ||
            extractYearFromText(item.title) ||
            extractYearFromText(item.snippet);

          if (year) {
            yearsFound.push(year);
            if (year <= currentYear - 2) {
              staleCount++;
            } else {
              freshCount++;
            }
          }

          return {
            position: item.position,
            title: item.title,
            domain,
            detectedDate: item.date,
            detectedYear: year,
          };
        });

        const freshestYearDetected = yearsFound.length
          ? Math.max(...yearsFound)
          : undefined;
        const oldestYearDetected = yearsFound.length
          ? Math.min(...yearsFound)
          : undefined;

        const averageYear = yearsFound.length
          ? Math.round(yearsFound.reduce((a, b) => a + b, 0) / yearsFound.length)
          : currentYear - 1;
        const averageAgeYears = Math.max(0, currentYear - averageYear);

        let freshnessOpportunity: FreshnessGapItem["freshnessOpportunity"];
        let actionableInsight = "";

        if (staleCount >= 3 || (freshestYearDetected && freshestYearDetected <= currentYear - 2)) {
          freshnessOpportunity = "High Opportunity (Outdated SERP)";
          actionableInsight = `Strong ranking advantage: Top ranking pages are outdated (average age ${averageAgeYears} years, oldest: ${oldestYearDetected}). Publishing a fresh guide with "${currentYear}" in the title and current data will heavily boost click-through and rankings.`;
        } else if (staleCount >= 1) {
          freshnessOpportunity = "Moderate";
          actionableInsight = `Moderate freshness gap: Some competitors are updating content, but several older guides remain. A comprehensive update will capture competitive traffic.`;
        } else {
          freshnessOpportunity = "Low (Consistently Fresh)";
          actionableInsight = `Active niche: Competitors actively refresh their content. Focus on deeper depth, original data, or proprietary examples rather than date alone.`;
        }

        results.push({
          keyword: kw,
          averageAgeYears,
          staleCount,
          freshCount,
          freshestYearDetected,
          oldestYearDetected,
          freshnessOpportunity,
          topCompetitorDates: competitorDates.slice(0, 5),
          actionableInsight,
        });
      } catch {
        // Skip failed keywords
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, keywords.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return {
    totalAnalyzed: keywords.length,
    results,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. High-CPC / Low-KD "Golden Ratio" Opportunity Hunter
// ────────────────────────────────────────────────────────────────────────────

export interface KeywordMetricInput {
  keyword: string;
  avgMonthlySearches: number;
  competition?: string;
  competitionIndex?: number;
  lowTopOfPageBid?: number | string;
  highTopOfPageBid?: number | string;
}

export interface GoldenRatioOpportunity {
  keyword: string;
  searchVolume: number;
  cpc: number; // parsed numeric CPC in USD
  difficultyScore: number;
  difficultyRating: string;
  goldenRatioScore: number; // (volume * cpc) / (kd + 1)
  rankingOpportunity: "Elite Money Keyword" | "Strong Commercial Opportunity" | "Moderate";
  actionablePlan: string;
}

export interface GoldenRatioHunterResult {
  totalAnalyzed: number;
  qualifyingOpportunitiesCount: number;
  opportunities: GoldenRatioOpportunity[];
}

export async function findHighCpcLowKdKeywords(
  keywordMetrics: KeywordMetricInput[],
  options: Omit<CheckSerpQueryOptions, "query">,
  envConfig: SerpEngineConfig,
  minSearchVolume = 200,
  minCpc = 2.0,
  maxKd = 45,
  concurrency = 3,
): Promise<GoldenRatioHunterResult> {
  const opportunities: GoldenRatioOpportunity[] = [];
  const queue = [...keywordMetrics];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      // Extract numeric CPC from highTopOfPageBid
      let cpc = 0;
      if (typeof item.highTopOfPageBid === "number") {
        cpc = item.highTopOfPageBid;
      } else if (typeof item.highTopOfPageBid === "string") {
        const cleaned = item.highTopOfPageBid.replace(/[^0-9.]/g, "");
        cpc = parseFloat(cleaned) || 0;
      }

      // Check pre-filters
      if (item.avgMonthlySearches < minSearchVolume || cpc < minCpc) {
        continue;
      }

      try {
        const kd = await checkKeywordDifficulty(
          { ...options, query: item.keyword },
          envConfig,
        );

        if (kd.difficultyScore <= maxKd) {
          // Golden Ratio Index: (Volume * CPC) / (KD + 1)
          const goldenRatioScore = Math.round(
            (item.avgMonthlySearches * cpc) / (kd.difficultyScore + 1),
          );

          let rankingOpportunity: GoldenRatioOpportunity["rankingOpportunity"];
          if (goldenRatioScore >= 500) {
            rankingOpportunity = "Elite Money Keyword";
          } else if (goldenRatioScore >= 150) {
            rankingOpportunity = "Strong Commercial Opportunity";
          } else {
            rankingOpportunity = "Moderate";
          }

          opportunities.push({
            keyword: item.keyword,
            searchVolume: item.avgMonthlySearches,
            cpc,
            difficultyScore: kd.difficultyScore,
            difficultyRating: kd.difficultyRating,
            goldenRatioScore,
            rankingOpportunity,
            actionablePlan: `High monetization potential: Advertisers pay $${cpc.toFixed(2)}/click with ${item.avgMonthlySearches}/mo volume, but SEO difficulty is only ${kd.difficultyScore}/100 (${kd.difficultyRating}). Prioritize building a dedicated high-converting landing page.`,
          });
        }
      } catch {
        // Skip failed
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, keywordMetrics.length) },
    () => worker(),
  );
  await Promise.all(workers);

  // Sort by Golden Ratio Score descending
  opportunities.sort((a, b) => b.goldenRatioScore - a.goldenRatioScore);

  return {
    totalAnalyzed: keywordMetrics.length,
    qualifyingOpportunitiesCount: opportunities.length,
    opportunities,
  };
}
