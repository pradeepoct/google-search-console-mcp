import assert from "node:assert";

// Mocking fetch responses to test SerpApi parsing, Serper parsing, and fallback switching logic
const originalFetch = globalThis.fetch;

async function runTests() {
  console.log("=== Testing SERP & AI Overview Module Logic ===");

  // Dynamic import of compiled/source module
  // We can test the logic directly
  let mockMode = "serpapi_success";

  globalThis.fetch = async (url, init) => {
    const urlStr = url.toString();

    if (mockMode === "serpapi_success") {
      if (urlStr.includes("serpapi.com")) {
        return new Response(
          JSON.stringify({
            search_metadata: { status: "Success" },
            ai_overview: {
              snippet: "This is a Google AI Overview summary text.",
              sources: [
                { title: "Source 1", link: "https://example.com/source1" },
              ],
            },
            answer_box: {
              title: "Featured Answer",
              snippet: "Direct answer text",
              link: "https://example.com/featured",
            },
            organic_results: [
              {
                position: 1,
                title: "Organic Result 1",
                link: "https://example.com/organic1",
                snippet: "Snippet text",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
    } else if (mockMode === "serpapi_quota_fallback") {
      if (urlStr.includes("serpapi.com")) {
        return new Response(
          JSON.stringify({
            error: "Your account has run out of searches for this month.",
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("google.serper.dev")) {
        return new Response(
          JSON.stringify({
            aiOverview: {
              snippet: "AI Overview returned via Serper.dev fallback.",
              sources: [{ title: "Serper Source", link: "https://serper.dev" }],
            },
            organic: [
              {
                position: 1,
                title: "Serper Organic 1",
                link: "https://example.com/page1",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
    }

    throw new Error(`Unhandled fetch url: ${urlStr}`);
  };

  const {
    fetchSerpApi,
    fetchSerperDev,
    checkKeywordSerpOverview,
    checkBatchSerpOverview,
  } = await import("../src/serp.ts");

  // Test 1: SerpApi success
  console.log("\n[Test 1] Testing SerpApi parser & successful response...");
  mockMode = "serpapi_success";
  const res1 = await checkKeywordSerpOverview(
    { query: "what is ai", provider: "auto" },
    { serpApiKey: "mock-serpapi-key", serperApiKey: "mock-serper-key" },
  );
  assert.strictEqual(res1.hasAiOverview, true);
  assert.strictEqual(res1.aiOverview.snippet, "This is a Google AI Overview summary text.");
  assert.strictEqual(res1.hasFeaturedSnippet, true);
  assert.strictEqual(res1.providerUsed, "serpapi");
  assert.strictEqual(res1.fallbackTriggered, false);
  console.log("✔ Test 1 Passed: Correctly parsed SerpApi AI overview and metadata.");

  // Test 2: SerpApi 429 Quota Exceeded -> Fallback to Serper.dev
  console.log("\n[Test 2] Testing automatic fallback from SerpApi to Serper.dev on quota error...");
  mockMode = "serpapi_quota_fallback";
  const res2 = await checkKeywordSerpOverview(
    { query: "marketing automation", provider: "auto" },
    { serpApiKey: "mock-serpapi-key", serperApiKey: "mock-serper-key" },
  );
  assert.strictEqual(res2.hasAiOverview, true);
  assert.strictEqual(res2.aiOverview.snippet, "AI Overview returned via Serper.dev fallback.");
  assert.strictEqual(res2.providerUsed, "serper");
  assert.strictEqual(res2.fallbackTriggered, true);
  assert.ok(res2.fallbackReason.includes("SerpApi failed"));
  console.log("✔ Test 2 Passed: Successfully caught SerpApi quota error and seamlessly switched to Serper.dev!");

  // Test 3: Batch Keywords
  console.log("\n[Test 3] Testing batch keywords processing...");
  const batchRes = await checkBatchSerpOverview(
    ["keyword 1", "keyword 2"],
    { provider: "auto" },
    { serpApiKey: "mock-serpapi-key", serperApiKey: "mock-serper-key" },
  );
  assert.strictEqual(batchRes.length, 2);
  assert.strictEqual(batchRes[0].query, "keyword 1");
  assert.strictEqual(batchRes[1].query, "keyword 2");
  console.log("✔ Test 3 Passed: Batch processing preserved query order and completed successfully.");

  // Restore fetch
  globalThis.fetch = originalFetch;
  console.log("\nAll SERP tests passed successfully!\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
