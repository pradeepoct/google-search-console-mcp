/**
 * Google Search Console Opportunity & Health Engine.
 *
 * Implements:
 *   1. "Striking Distance" keyword finder (positions 8-20 with high impressions).
 *   2. Keyword Cannibalization detector (multiple internal URLs competing for the same query).
 */

import { querySearchAnalytics, type SearchAnalyticsRow } from "./gsc";

export interface StrikingDistanceOptions {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  minPosition?: number; // default 8.0
  maxPosition?: number; // default 20.0
  minImpressions?: number; // default 100
  rowLimit?: number; // default 1000
}

export interface StrikingDistanceItem {
  query: string;
  page: string;
  currentPosition: number;
  impressions: number;
  clicks: number;
  currentCtrPercent: number;
  estimatedTop3Clicks: number;
  potentialClickGain: number;
  actionRecommendation: string;
}

export interface StrikingDistanceResult {
  siteUrl: string;
  dateRange: { startDate: string; endDate: string };
  totalOpportunitiesFound: number;
  totalPotentialClickGain: number;
  opportunities: StrikingDistanceItem[];
}

function getDefaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 3); // GSC has ~2-3 days data lag
  const start = new Date(end);
  start.setDate(start.getDate() - 28); // 28 days window

  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

export async function findStrikingDistanceKeywords(
  token: string,
  opts: StrikingDistanceOptions,
): Promise<StrikingDistanceResult> {
  const dates =
    opts.startDate && opts.endDate
      ? { startDate: opts.startDate, endDate: opts.endDate }
      : getDefaultDateRange();

  const minPos = opts.minPosition ?? 8.0;
  const maxPos = opts.maxPosition ?? 20.0;
  const minImpressions = opts.minImpressions ?? 100;
  const rowLimit = opts.rowLimit ?? 1000;

  const res = await querySearchAnalytics(token, opts.siteUrl, {
    startDate: dates.startDate,
    endDate: dates.endDate,
    dimensions: ["query", "page"],
    rowLimit,
  });

  const rows = res.rows || [];
  const opportunities: StrikingDistanceItem[] = [];

  for (const row of rows) {
    if (!row.keys || row.keys.length < 2) continue;
    const query = row.keys[0];
    const page = row.keys[1];
    const position = Math.round(row.position * 10) / 10;
    const impressions = row.impressions;
    const clicks = row.clicks;

    if (position >= minPos && position <= maxPos && impressions >= minImpressions) {
      const currentCtrPercent = Math.round(row.ctr * 10000) / 100;
      // Position 1-3 typically captures ~18% average CTR
      const estimatedTop3Clicks = Math.round(impressions * 0.18);
      const potentialClickGain = Math.max(0, estimatedTop3Clicks - clicks);

      let actionRecommendation = "";
      if (position <= 12) {
        actionRecommendation = `Very close to top 3 (Rank #${position}). Add an exact-match H2 section on "${query}", optimize the page title tag, and add 2 internal links from your highest-authority pages.`;
      } else {
        actionRecommendation = `Page 2 ranking (Rank #${position}). Expand the section covering "${query}", add structured FAQs, and build internal links with topical anchor text.`;
      }

      opportunities.push({
        query,
        page,
        currentPosition: position,
        impressions,
        clicks,
        currentCtrPercent,
        estimatedTop3Clicks,
        potentialClickGain,
        actionRecommendation,
      });
    }
  }

  // Sort by potential click gain descending
  opportunities.sort((a, b) => b.potentialClickGain - a.potentialClickGain);

  const totalPotentialClickGain = opportunities.reduce(
    (acc, o) => acc + o.potentialClickGain,
    0,
  );

  return {
    siteUrl: opts.siteUrl,
    dateRange: dates,
    totalOpportunitiesFound: opportunities.length,
    totalPotentialClickGain,
    opportunities,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Keyword Cannibalization Detector
// ────────────────────────────────────────────────────────────────────────────

export interface CannibalizationOptions {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  minImpressions?: number; // default 50
  rowLimit?: number; // default 2500
}

export interface CompetingPage {
  page: string;
  clicks: number;
  impressions: number;
  ctrPercent: number;
  averagePosition: number;
  impressionSharePercent: number;
  clickSharePercent: number;
}

export interface CannibalizationItem {
  query: string;
  severity: "Critical" | "Moderate" | "Minor";
  totalImpressions: number;
  totalClicks: number;
  competingPagesCount: number;
  competingPages: CompetingPage[];
  recommendedAction: string;
}

export interface CannibalizationResult {
  siteUrl: string;
  dateRange: { startDate: string; endDate: string };
  totalCannibalizedQueries: number;
  criticalCount: number;
  moderateCount: number;
  minorCount: number;
  cannibalizedQueries: CannibalizationItem[];
}

export async function findKeywordCannibalization(
  token: string,
  opts: CannibalizationOptions,
): Promise<CannibalizationResult> {
  const dates =
    opts.startDate && opts.endDate
      ? { startDate: opts.startDate, endDate: opts.endDate }
      : getDefaultDateRange();

  const minImpressions = opts.minImpressions ?? 50;
  const rowLimit = opts.rowLimit ?? 2500;

  const res = await querySearchAnalytics(token, opts.siteUrl, {
    startDate: dates.startDate,
    endDate: dates.endDate,
    dimensions: ["query", "page"],
    rowLimit,
  });

  const rows = res.rows || [];
  const queryMap = new Map<string, SearchAnalyticsRow[]>();

  for (const row of rows) {
    if (!row.keys || row.keys.length < 2) continue;
    const query = row.keys[0];
    if (!queryMap.has(query)) {
      queryMap.set(query, []);
    }
    queryMap.get(query)!.push(row);
  }

  const cannibalizedQueries: CannibalizationItem[] = [];

  for (const [query, pageRows] of queryMap.entries()) {
    if (pageRows.length < 2) continue;

    const totalImpressions = pageRows.reduce((a, b) => a + b.impressions, 0);
    const totalClicks = pageRows.reduce((a, b) => a + b.clicks, 0);

    if (totalImpressions < minImpressions) continue;

    const competingPages: CompetingPage[] = pageRows.map((r) => {
      const page = r.keys![1];
      const impressionSharePercent =
        totalImpressions > 0
          ? Math.round((r.impressions / totalImpressions) * 1000) / 10
          : 0;
      const clickSharePercent =
        totalClicks > 0
          ? Math.round((r.clicks / totalClicks) * 1000) / 10
          : 0;

      return {
        page,
        clicks: r.clicks,
        impressions: r.impressions,
        ctrPercent: Math.round(r.ctr * 10000) / 100,
        averagePosition: Math.round(r.position * 10) / 10,
        impressionSharePercent,
        clickSharePercent,
      };
    });

    // Sort competing pages by impressions descending
    competingPages.sort((a, b) => b.impressions - a.impressions);

    // Determine Severity:
    // Critical: Top 2 pages each have >= 25% impression share
    // Moderate: Top 2 pages have >= 15% impression share
    // Minor: One dominant page >= 80% and secondary has < 15%
    let severity: CannibalizationItem["severity"];
    let recommendedAction = "";

    const secondPageShare = competingPages[1]?.impressionSharePercent ?? 0;
    const firstPagePos = competingPages[0]?.averagePosition ?? 50;
    const secondPagePos = competingPages[1]?.averagePosition ?? 50;

    if (secondPageShare >= 25 && (firstPagePos <= 25 || secondPagePos <= 25)) {
      severity = "Critical";
      recommendedAction = `Google is actively dividing ranking authority between both pages. Choose the stronger page (${competingPages[0].page}) as the primary canonical, and either 301-redirect or re-target (${competingPages[1].page}) to a distinct secondary topic.`;
    } else if (secondPageShare >= 15) {
      severity = "Moderate";
      recommendedAction = `Moderate authority split. Ensure ${competingPages[1].page} links back to ${competingPages[0].page} using '${query}' as anchor text to signal the definitive target URL.`;
    } else {
      severity = "Minor";
      recommendedAction = `${competingPages[0].page} is dominant (${competingPages[0].impressionSharePercent}% share). Minor cannibalization; adjust secondary page anchor text or headings if it begins stealing clicks.`;
    }

    cannibalizedQueries.push({
      query,
      severity,
      totalImpressions,
      totalClicks,
      competingPagesCount: competingPages.length,
      competingPages,
      recommendedAction,
    });
  }

  // Sort by severity (Critical -> Moderate -> Minor) then impressions
  const severityRank = { Critical: 3, Moderate: 2, Minor: 1 };
  cannibalizedQueries.sort((a, b) => {
    const diff = severityRank[b.severity] - severityRank[a.severity];
    if (diff !== 0) return diff;
    return b.totalImpressions - a.totalImpressions;
  });

  return {
    siteUrl: opts.siteUrl,
    dateRange: dates,
    totalCannibalizedQueries: cannibalizedQueries.length,
    criticalCount: cannibalizedQueries.filter((c) => c.severity === "Critical").length,
    moderateCount: cannibalizedQueries.filter((c) => c.severity === "Moderate").length,
    minorCount: cannibalizedQueries.filter((c) => c.severity === "Minor").length,
    cannibalizedQueries,
  };
}
