/**
 * Google Analytics 4 (GA4) REST API wrapper.
 * Uses Google Analytics Admin API v1beta & Data API v1beta.
 */

const GA4_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const GA4_DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";

async function ga4Fetch<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GA4 API ${response.status} on ${url}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

function normalizePropertyId(propertyId: string): string {
  const clean = propertyId.trim().replace(/^properties\//, "");
  return `properties/${clean}`;
}

export interface GA4PropertySummary {
  property: string; // e.g. "properties/123456789"
  displayName: string;
  propertyType?: string;
}

export interface GA4AccountSummary {
  name: string;
  account: string;
  displayName: string;
  propertySummaries?: GA4PropertySummary[];
}

export interface ListGA4PropertiesResponse {
  accountSummaries?: GA4AccountSummary[];
  nextPageToken?: string;
}

export async function listGA4Properties(
  token: string,
): Promise<{ properties: Array<{ propertyId: string; propertyName: string; accountName: string }> }> {
  const data = await ga4Fetch<ListGA4PropertiesResponse>(
    `${GA4_ADMIN_BASE}/accountSummaries?pageSize=200`,
    token,
  );

  const properties: Array<{ propertyId: string; propertyName: string; accountName: string }> = [];

  for (const account of data.accountSummaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      properties.push({
        propertyId: prop.property.replace(/^properties\//, ""),
        propertyName: prop.displayName,
        accountName: account.displayName,
      });
    }
  }

  return { properties };
}

export interface GA4ReportQuery {
  propertyId: string;
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  limit?: number;
  offset?: number;
  dimensionFilter?: Record<string, unknown>;
}

export async function queryGA4Report(
  token: string,
  params: GA4ReportQuery,
): Promise<unknown> {
  const propertyPath = normalizePropertyId(params.propertyId);
  const url = `${GA4_DATA_BASE}/${propertyPath}:runReport`;

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
    metrics: params.metrics.map((name) => ({ name })),
    limit: params.limit ?? 1000,
    offset: params.offset ?? 0,
  };

  if (params.dimensions && params.dimensions.length > 0) {
    body.dimensions = params.dimensions.map((name) => ({ name }));
  }

  if (params.dimensionFilter) {
    body.dimensionFilter = params.dimensionFilter;
  }

  return ga4Fetch(url, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface GA4RealtimeQuery {
  propertyId: string;
  metrics: string[];
  dimensions?: string[];
  limit?: number;
}

export async function queryGA4Realtime(
  token: string,
  params: GA4RealtimeQuery,
): Promise<unknown> {
  const propertyPath = normalizePropertyId(params.propertyId);
  const url = `${GA4_DATA_BASE}/${propertyPath}:runRealtimeReport`;

  const body: Record<string, unknown> = {
    metrics: params.metrics.map((name) => ({ name })),
    limit: params.limit ?? 100,
  };

  if (params.dimensions && params.dimensions.length > 0) {
    body.dimensions = params.dimensions.map((name) => ({ name }));
  }

  return ga4Fetch(url, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
