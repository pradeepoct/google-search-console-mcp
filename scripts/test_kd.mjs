import fs from 'fs';

const envText = fs.readFileSync('.dev.vars', 'utf-8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

async function run() {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: 'best crm for startups', gl: 'us', hl: 'en' })
  });
  const data = await res.json();
  
  const MEGA_AUTHORITIES = new Set([
    'wikipedia.org', 'amazon.com', 'apple.com', 'microsoft.com', 'google.com',
    'youtube.com', 'nytimes.com', 'forbes.com', 'healthline.com', 'webmd.com',
    'mayoclinic.org', 'investopedia.com', 'hubspot.com', 'yelp.com', 'tripadvisor.com',
    'g2.com', 'trustpilot.com', 'cnet.com', 'bbb.org', 'nih.gov', 'cdc.gov'
  ]);
  const UGC_DOMAINS = new Set([
    'reddit.com', 'quora.com', 'medium.com', 'linkedin.com', 'pinterest.com',
    'facebook.com', 'twitter.com', 'x.com', 'threads.net', 'stackoverflow.com'
  ]);
  
  function extractDomain(urlStr) {
    try {
      const u = new URL(urlStr);
      return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return urlStr;
    }
  }

  const keyword = 'best crm for startups';
  const kwTerms = keyword.split(' ').filter(w => w.length > 2);

  let weightedSum = 0;
  let totalWeight = 0;
  let exactCount = 0;
  let ugcCount = 0;
  
  const competitors = data.organic.map((item, idx) => {
    const domain = extractDomain(item.link);
    const isUgc = UGC_DOMAINS.has(domain) || domain.includes('forum');
    const isMega = MEGA_AUTHORITIES.has(domain);
    let score = 45;
    if (isMega) score = 95;
    else if (isUgc) { score = 20; ugcCount++; }
    
    const pos = idx + 1;
    const w = pos <= 3 ? 1.6 : (pos <= 6 ? 1.0 : 0.6);
    weightedSum += score * w;
    totalWeight += w;
    
    if (item.title.toLowerCase().includes(keyword)) exactCount++;
    return { pos, domain, title: item.title, isUgc, score };
  });

  const daFactor = Math.round(weightedSum / totalWeight);
  const onPageFactor = Math.min(100, exactCount * 12);
  let raw = daFactor * 0.55 + onPageFactor * 0.3 + 20 * 0.15;
  if (competitors.slice(0, 3).some(c => c.isUgc)) raw -= 12;
  const kd = Math.min(99, Math.max(1, Math.round(raw)));

  console.log('Results:');
  console.log('Keyword Difficulty (0-100):', kd);
  console.log('Domain Authority Factor:', daFactor);
  console.log('UGC Competitors in top 10:', ugcCount);
  console.log('Competitors:', competitors.slice(0, 5));
}

run();
