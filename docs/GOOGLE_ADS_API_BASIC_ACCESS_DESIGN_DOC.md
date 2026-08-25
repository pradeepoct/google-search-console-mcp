# Google Ads API — Basic Access Application & Technical Design Document

**Document Version:** 1.0  
**Date:** August 25, 2026  
**Applicant / Company:** Aiskyla ([https://aiskyla.com/](https://aiskyla.com/))  
**Tool Name:** Aiskyla Internal MCP Server  
**Requested Access Level:** Basic Access (Developer Token)  
**Primary Contact:** Engineering & Infrastructure Team ([contact@aiskyla.com](mailto:contact@aiskyla.com))

---

## 1. Company Overview

| Attribute | Details |
| :--- | :--- |
| **Legal Entity / Brand** | Aiskyla |
| **Website** | [https://aiskyla.com/](https://aiskyla.com/) |
| **Primary Products** | AI-driven workflow tools, WisCall platform, and SEO optimization systems |
| **Target User Base** | **Internal Only** — Restricted strictly to verified Aiskyla employees, data analysts, and engineering contractors. |
| **Commercial Model** | Private internal enterprise utility. The tool is **not** distributed to external third parties, is **not** offered as a SaaS product, and has **no public-facing interface**. |

---

## 2. Tool Overview & Business Purpose

### 2.1 Summary
The **Aiskyla Internal MCP Server** is a private, self-hosted Model Context Protocol (MCP) service designed exclusively for internal content strategy, programmatic SEO research, and market demand analysis across our digital properties (including WisCall and Aiskyla).

### 2.2 Functional Purpose
The tool acts as a secure connector between internal research agents (LLM-based assistant interfaces used by our editorial and marketing teams) and the Google Ads API. It enables internal analysts to programmatically evaluate keyword demand, search trends, and market competitiveness before producing high-quality informational content.

### 2.3 Strict Scope & Explicit Limitations
To ensure strict compliance with Google Ads API Policies and Developer Terms:
* **Strictly Read-Only:** The tool solely consumes search volume metrics and keyword suggestions.
* **No Campaign Modification:** The tool **does not** create, edit, update, pause, or delete Google Ads campaigns, ad groups, responsive search ads, or ad extensions.
* **No Automated Bidding or Budgeting:** The tool **does not** modify bids, budgets, billing settings, or bidding strategies.
* **No Account Management:** The tool **does not** manage client accounts, user permissions, or conversion tracking.
* **No External Redistribution:** Raw Google Ads API metrics are never resold or made available to the public.

---

## 3. API Services & Technical Scope

### 3.1 Requested API Services
The application requires access to a single, read-only service within the Google Ads API:

* **Service:** `KeywordPlanIdeaService` (REST / gRPC)
* **Methods Utilized:**
  1. `GenerateKeywordIdeas`: To discover related keyword suggestions based on seed phrases or target landing page URLs.
  2. `GenerateKeywordHistoricalMetrics`: To retrieve historical search metrics for an explicit list of keyword candidates.

### 3.2 Specific Metrics Extracted
The tool processes only high-level keyword volume and estimation metrics:

| Metric Field | Google Ads API Property | Purpose |
| :--- | :--- | :--- |
| **Average Monthly Searches** | `keyword_idea_metrics.avg_monthly_searches` | Quantify search demand and topic relevance. |
| **Competition Level / Index** | `keyword_idea_metrics.competition` / `competition_index` | Evaluate search landscape density. |
| **Top of Page Bid (Low Range)** | `keyword_idea_metrics.low_top_of_page_bid_micros` | Estimate entry-level commercial intent (converted from micros to standard currency). |
| **Top of Page Bid (High Range)** | `keyword_idea_metrics.high_top_of_page_bid_micros` | Estimate upper-bound commercial intent. |
| **Monthly Search Breakdown** | `keyword_idea_metrics.monthly_search_volumes` | Identify seasonal demand fluctuations over the past 12 months. |

---

## 4. Architecture & Data Flow

### 4.1 Architectural Diagram

```
+-------------------------------------------------------------------------+
|                          AISKYLA INTERNAL NETWORK                       |
|                                                                         |
|  +---------------------------+       JSON-RPC (MCP)                     |
|  | Internal User / AI Agent  | ------------------------+                |
|  | (Employee / Analyst)      |                         |                |
|  +---------------------------+                         v                |
|                                         +----------------------------+  |
|                                         | Aiskyla Internal           |  |
|                                         | MCP Server Engine          |  |
|                                         +----------------------------+  |
|                                                        |                |
+--------------------------------------------------------|----------------+
                                                         |
                              OAuth 2.0 + Developer Token| HTTPS / REST v25
                                                         v
                                          +----------------------------+
                                          | Google Ads API             |
                                          | KeywordPlanIdeaService     |
                                          +----------------------------+
```

### 4.2 End-to-End Execution Sequence
1. **Query Initiation:** An internal user or automated content planning workflow submits a list of seed keywords (e.g., `["voice automation", "call routing software"]`) to the internal MCP Server.
2. **Authentication & Authorization:** 
   - The server validates that the request originated from an authenticated internal employee.
   - The server authenticates against our Google Ads Manager Account (MCC) using OAuth 2.0 credentials (`https://www.googleapis.com/auth/adwords` scope) along with our assigned Developer Token.
3. **Upstream Request:** The server transmits an HTTP `POST` request to `https://googleads.googleapis.com/v25/customers/{CUSTOMER_ID}:generateKeywordIdeas`.
4. **Data Normalization:** The server receives the raw protobuf/JSON payload from Google, parses the relevant metric fields (`avg_monthly_searches`, `competition`, converted CPC values), and formats them into a clean, normalized JSON response.
5. **Real-Time Delivery:** The formatted JSON payload is returned in real-time to the internal assistant for immediate decision-making.

### 4.3 Data Storage Policy
* **Zero Persistent Storage:** Data returned by the Google Ads API is processed ephemerally in-memory.
* **No Database Syncing:** Keyword metrics are not stored in relational databases, data lakes, or external warehouses.

---

## 5. Security, Compliance & Privacy

### 5.1 Authentication & Credential Storage
* **OAuth 2.0 Compliance:** User authorization follows strict Google OAuth 2.0 guidelines using PKCE and secure token refresh mechanisms.
* **Secret Management:** OAuth Client Secrets and the Google Ads Developer Token are stored securely within encrypted key management systems (Cloudflare Secrets / Encrypted Environment Variables) and are never exposed to client-side code or git repositories.

### 5.2 Access Control
* Access to the MCP server endpoint is gated by a cryptographically secure access key (`MCP_BEARER_TOKEN`) issued solely to verified Aiskyla personnel.
* Operations are restricted by IP allowlisting and Cloudflare Zero Trust network policies.

### 5.3 Google Ads Policy Adherence
* **Read-Only Guarantee:** The application codebase has zero mutative API calls (`CampaignService`, `AdGroupService`, `AdGroupCriterionService`, or `BiddingStrategyService` are completely absent from the implementation).
* **Quota Respect:** The tool implements strict rate limiting and backoff routines to operate comfortably within standard API limits.

---

## 6. Verification & Output Proof

### Example Tool Invocation Payload
```json
{
  "customerId": "8574259427",
  "keywords": ["ai voice assistant", "call automation"],
  "geoTargetConstants": ["US", "IN"],
  "language": "en"
}
```

### Example Tool Output Structure
```json
{
  "customerId": "8574259427",
  "keywordCount": 2,
  "keywords": [
    {
      "keyword": "ai voice assistant",
      "avgMonthlySearches": 49500,
      "competition": "MEDIUM",
      "competitionIndex": 48,
      "lowTopOfPageBid": 1.25,
      "highTopOfPageBid": 4.80,
      "averageCpc": 2.10
    },
    {
      "keyword": "call automation",
      "avgMonthlySearches": 8100,
      "competition": "HIGH",
      "competitionIndex": 82,
      "lowTopOfPageBid": 3.40,
      "highTopOfPageBid": 11.50,
      "averageCpc": 6.75
    }
  ]
}
```

---

### [Insert Screenshot of MCP Server JSON Output/Terminal Here]

*(Attach screenshot of the internal terminal / interface showing the successful execution and JSON metric output above before converting to PDF.)*

---

**Submitted by:**  
Engineering Lead & Architecture Team  
**Aiskyla** — [https://aiskyla.com/](https://aiskyla.com/)
