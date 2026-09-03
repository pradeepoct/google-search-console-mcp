/**
 * Google Autocomplete & "Alphabet Soup" Long-Tail Engine.
 *
 * Direct, 100% free integration with Google's real-time Suggest service.
 * Discovers newly trending, zero-competition long-tail search queries
 * before traditional SEO databases even index them.
 */

export type AutocompleteStrategy =
  | "standard"
  | "alphabet"
  | "questions"
  | "comparisons"
  | "commercial"
  | "all";

export interface AutocompleteOptions {
  query: string;
  country?: string; // e.g. "us", "uk", "in"
  language?: string; // e.g. "en", "es", "fr"
  strategy?: AutocompleteStrategy;
  maxResults?: number;
}

export interface GroupedSuggestions {
  category: string;
  prefixUsed: string;
  suggestions: string[];
}

export interface AutocompleteResult {
  seedQuery: string;
  strategy: AutocompleteStrategy;
  country: string;
  language: string;
  totalUniqueSuggestions: number;
  suggestions: string[];
  groupedResults?: GroupedSuggestions[];
}

/**
 * Fetch raw suggestions for a single query string from Google Suggest.
 */
export async function fetchGoogleSuggestions(
  query: string,
  country = "us",
  language = "en",
): Promise<string[]> {
  const url = new URL("https://suggestqueries.google.com/complete/search");
  url.searchParams.set("client", "chrome");
  url.searchParams.set("hl", language);
  url.searchParams.set("gl", country);
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data: any = await response.json();
    if (Array.isArray(data) && Array.isArray(data[1])) {
      return data[1].filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Run concurrent bounded requests to Google Suggest for multiple prefixes.
 */
async function fetchBatchSuggestions(
  prefixes: Array<{ category: string; prefix: string }>,
  country: string,
  language: string,
  concurrency = 5,
): Promise<GroupedSuggestions[]> {
  const results: GroupedSuggestions[] = [];
  const queue = [...prefixes];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const suggestions = await fetchGoogleSuggestions(item.prefix, country, language);
      if (suggestions.length > 0) {
        results.push({
          category: item.category,
          prefixUsed: item.prefix,
          suggestions,
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, prefixes.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Expand a seed keyword across multiple modifier strategies.
 */
export async function expandAutocomplete(
  opts: AutocompleteOptions,
): Promise<AutocompleteResult> {
  const query = opts.query.trim();
  const country = opts.country || "us";
  const language = opts.language || "en";
  const strategy = opts.strategy || "all";
  const maxResults = opts.maxResults || 100;

  if (strategy === "standard") {
    const suggestions = await fetchGoogleSuggestions(query, country, language);
    return {
      seedQuery: query,
      strategy,
      country,
      language,
      totalUniqueSuggestions: suggestions.length,
      suggestions: suggestions.slice(0, maxResults),
    };
  }

  const prefixesToFetch: Array<{ category: string; prefix: string }> = [];

  // Always include standard base query
  prefixesToFetch.push({ category: "Standard", prefix: query });

  if (strategy === "alphabet" || strategy === "all") {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    for (const letter of letters) {
      prefixesToFetch.push({
        category: `Alphabet (${letter.toUpperCase()})`,
        prefix: `${query} ${letter}`,
      });
    }
  }

  if (strategy === "questions" || strategy === "all") {
    const questionStarters = [
      `how to ${query}`,
      `why ${query}`,
      `what is ${query}`,
      `can ${query}`,
      `where to ${query}`,
      `is ${query} good for`,
      `how does ${query}`,
    ];
    for (const q of questionStarters) {
      prefixesToFetch.push({ category: "Questions", prefix: q });
    }
  }

  if (strategy === "comparisons" || strategy === "all") {
    const compStarters = [
      `${query} vs`,
      `${query} or`,
      `${query} alternative`,
      `${query} compared to`,
    ];
    for (const c of compStarters) {
      prefixesToFetch.push({ category: "Comparisons", prefix: c });
    }
  }

  if (strategy === "commercial" || strategy === "all") {
    const commStarters = [
      `best ${query} for`,
      `cheap ${query}`,
      `top ${query}`,
      `${query} pricing`,
      `${query} reviews`,
      `${query} for small business`,
    ];
    for (const c of commStarters) {
      prefixesToFetch.push({ category: "Commercial Intent", prefix: c });
    }
  }

  const grouped = await fetchBatchSuggestions(
    prefixesToFetch,
    country,
    language,
    6,
  );

  const seen = new Set<string>();
  const allUnique: string[] = [];

  for (const group of grouped) {
    for (const sug of group.suggestions) {
      const normalized = sug.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        allUnique.push(sug);
      }
    }
  }

  return {
    seedQuery: query,
    strategy,
    country,
    language,
    totalUniqueSuggestions: allUnique.length,
    suggestions: allUnique.slice(0, maxResults),
    groupedResults: grouped,
  };
}
