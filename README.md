# gsc-mcp-connector

> Self-hosted Google Search Console MCP server, deployable to Cloudflare Workers in 15 minutes. Plug it into ChatGPT, Claude, or any MCP-capable client and query your GSC data in natural language.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JuJu78/gsc-mcp-connector)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What this gives you

Once deployed, you get a private MCP endpoint that exposes 4 tools to your AI assistant:

- `list_sites` — discover every property the connector can read
- `query_search_analytics` — clicks, impressions, CTR, position, filterable by query / page / country / device / search appearance / date
- `inspect_url` — full URL Inspection API output (indexing status, canonical, mobile, AMP)
- `list_sitemaps` — every submitted sitemap and its processing status

You ask: *"Quelles sont mes 50 requêtes avec la plus grosse perte de clics entre les 28 derniers jours et les 28 jours précédents ?"* and the assistant pulls the data, computes the delta, and writes the analysis. No more SQL exports.

## Prerequisites

| Item | Cost | Required ? |
|---|---|---|
| ChatGPT Plus / Pro / Team **or** Claude.ai Pro / Team | $20/mo+ | Custom MCP connectors are gated on paid plans. |
| Cloudflare account | Free tier is enough | Yes |
| Google Cloud project | Free | Yes — to create a Service Account |
| Verified Search Console property | Free | Yes (you already have it) |
| Node.js 20+ + `wrangler` CLI | Free | Only if you deploy via CLI; the *Deploy to Cloudflare* button skips this |

The Cloudflare Workers free tier (100k requests/day, 10ms CPU/request) is largely enough for personal SEO usage. No paid plan needed.

## Quick start (15 min)

### 1. Deploy the Worker

Click the **Deploy to Cloudflare** button above. Cloudflare clones the repo into your account, installs deps, and gives you a public URL like `https://gsc-mcp-connector.<your-subdomain>.workers.dev`.

(Alternative: `git clone` + `npm install` + `npx wrangler deploy`.)

### 2. Create a Google Service Account

Follow [docs/SETUP_GCP.md](docs/SETUP_GCP.md). You will get a JSON key file. Keep it safe — it's the equivalent of a password to your GSC data.

### 3. Add the Service Account email to your GSC properties

In Search Console → Settings → Users and permissions → **Add user** → paste the `client_email` from the JSON file → role *Restricted* is enough. Repeat for every property you want exposed.

### 4. Configure the Worker secrets

```bash
# Paste the full JSON when prompted (no quotes needed)
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON

# Generate and paste a random token
openssl rand -hex 32
npx wrangler secret put MCP_BEARER_TOKEN
```

Or via the Cloudflare dashboard: **Workers & Pages** → your worker → **Settings** → **Variables and Secrets** → *Add variable* → **Encrypt**.

### 5. Plug into ChatGPT

ChatGPT (Plus/Pro/Team) → **Settings** → **Connectors** → *Add custom connector* :

- **MCP Server URL** : `https://gsc-mcp-connector.<your-subdomain>.workers.dev/mcp`
- **Auth** : Bearer token
- **Token** : the value of `MCP_BEARER_TOKEN`

Open a new chat → enable the connector → ask *"List my GSC sites"* to confirm.

### Plug into Claude.ai (Pro/Team)

Settings → **Integrations** → **Add custom integration** → same URL + bearer token.

## Local development

```bash
git clone https://github.com/JuJu78/gsc-mcp-connector
cd gsc-mcp-connector
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars with your service account JSON + bearer token
npx wrangler dev
```

The dev server proxies `/mcp` and `/sse` locally. To test with a real MCP inspector:

```bash
npx @modelcontextprotocol/inspector
# URL: http://localhost:8787/mcp
# Auth: Bearer <MCP_BEARER_TOKEN>
```

## How auth works

Two layers, both opaque to the user:

1. **Worker → Google** : the Worker signs an RS256 JWT with the Service Account private key (Web Crypto API, no Node deps), exchanges it for an OAuth2 access token, caches the token until expiry.
2. **Client → Worker** : every request must carry `Authorization: Bearer <MCP_BEARER_TOKEN>`. The token is just a long random string you set yourself; it has no expiry. Rotate it by setting a new secret + updating the connector config.

The Service Account only has `webmasters.readonly` scope — the connector cannot modify your GSC.

## Limitations

- **Read-only.** Adding write operations (submit sitemap, request indexing) is left out by design. They are dangerous in an LLM context — open a PR if you need them.
- **No multi-user OAuth.** This is a single-tenant setup: one Service Account, one bearer token, one operator. For SaaS-style multi-user, you would need Cloudflare's [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider). Out of scope here.
- **GSC API quotas.** 1200 queries/min/project, 30k/day. Plenty for interactive use; if you script bulk queries, watch the headers.
- **Date range.** GSC only returns the last 16 months. The connector forwards your dates as-is; the API errors if you go further back.

## Troubleshooting

- **`Google OAuth token exchange failed`** : the Service Account JSON is malformed (line breaks lost when pasting), or the Search Console API is not enabled in your GCP project. See [docs/SETUP_GCP.md](docs/SETUP_GCP.md).
- **`User does not have sufficient permission`** : the Service Account email is not added to the GSC property. Add it via Search Console → Settings → Users.
- **`Missing or invalid bearer token`** : `MCP_BEARER_TOKEN` mismatch. Check the secret in Cloudflare and the value in your client config.
- **ChatGPT says "no tools available"** : ChatGPT requires the Streamable HTTP transport at `/mcp`, not `/sse`. Make sure your URL ends with `/mcp`.

## Roadmap

- [ ] Domain whitelist for the Service Account (optional KV-backed allowlist)
- [ ] Comparison tool (period vs period delta) baked in
- [ ] Optional KV cache for analytics responses (stretch — most agents prefer fresh data)

## License

MIT — see [LICENSE](LICENSE).

Built by [Julien Gourdon](https://julien-gourdon.fr) — SEO consultant exploring the intersection of search and AI.
