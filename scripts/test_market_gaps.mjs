import fs from 'fs';
import { findRedditForumContentGaps, getPeopleAlsoAskTree, detectSerpFreshnessGaps } from '../src/market_gaps.ts';

const envText = fs.readFileSync('.dev.vars', 'utf-8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const serpConfig = {
  serpApiKey: env.SERPAPI_API_KEY,
  serperApiKey: env.SERPER_API_KEY
};

async function test() {
  console.log('Testing Reddit Forum Content Gap Hunter...');
  const gaps = await findRedditForumContentGaps(
    ['best crm for startups', 'how to hire first engineer'],
    { country: 'us', language: 'en', provider: 'serper' },
    serpConfig,
    5
  );
  console.log('Total gaps found:', gaps.totalGapsFound);
  console.log('Sample gap:', gaps.gaps[0]);

  console.log('\nTesting People Also Ask (PAA) Tree...');
  const paa = await getPeopleAlsoAskTree(
    { query: 'best crm for startups', country: 'us', language: 'en', provider: 'serper' },
    serpConfig
  );
  console.log('PAA total questions:', paa.totalQuestions);
  console.log('PAA categories:', paa.categorizedQuestions.map(q => `[${q.category}] ${q.question}`));

  console.log('\nTesting Freshness Gap Detector...');
  const freshness = await detectSerpFreshnessGaps(
    ['best crm for startups'],
    { country: 'us', language: 'en', provider: 'serper' },
    serpConfig
  );
  console.log('Freshness result:', freshness.results[0]?.freshnessOpportunity);
  console.log('Actionable insight:', freshness.results[0]?.actionableInsight);
}

test().catch(console.error);
