import { HttpError } from "./auth.js";
import { locate } from "./geo.js";
import { RANGES, type RangeKey } from "./ranges.js";
import type { Quota } from "./scheduler.js";
import type {
  MapPoint,
  NamedCount,
  PropertySummary,
  Property,
  PropertyStats,
  RealtimeProperty,
  SeriesPoint,
  Totals,
} from "./types.js";

const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

const METRICS = [
  "activeUsers",
  "newUsers",
  "sessions",
  "screenPageViews",
  "averageSessionDuration",
  "engagementRate",
] as const;

type ReportRow = {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
};
type QuotaBucket = { consumed?: number; remaining?: number };
type Report = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: ReportRow[];
  totals?: ReportRow[];
  propertyQuota?: {
    tokensPerHour?: QuotaBucket;
    tokensPerDay?: QuotaBucket;
    concurrentRequests?: QuotaBucket;
  };
};
type BatchReports = { reports?: Report[] };

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dim = (row: ReportRow, i: number) => row.dimensionValues?.[i]?.value ?? "";
const met = (row: ReportRow, i: number) => num(row.metricValues?.[i]?.value);

async function gaFetch<T>(token: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep the raw body */
    }
    throw new HttpError(res.status, message);
  }
  return (await res.json()) as T;
}

/** Every GA4 property the signed-in account can read, across all accounts. */
export async function listProperties(token: string): Promise<PropertySummary[]> {
  type Summary = {
    displayName?: string;
    propertySummaries?: { property?: string; displayName?: string; propertyType?: string }[];
  };
  const found: PropertySummary[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(ADMIN_API + "/accountSummaries");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const page = await gaFetch<{ accountSummaries?: Summary[]; nextPageToken?: string }>(
      token,
      url.toString(),
    );

    for (const account of page.accountSummaries ?? []) {
      for (const summary of account.propertySummaries ?? []) {
        const id = summary.property?.split("/")[1];
        if (!id) continue;
        found.push({
          id,
          name: summary.displayName || "Property " + id,
          account: account.displayName ?? "",
        });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  // One dataStreams call per property, bounded like the Data API fan-out below.
  // The result is cached upstream with the listing, so this runs once per TTL.
  const domains = await pool(found, 5, (p) => domainFor(token, p.id));
  domains.forEach((domain, i) => {
    if (domain) found[i].domain = domain;
  });

  return found;
}

/**
 * Host of the property's first web data stream, used by the client to render
 * the site's favicon. App-only (iOS/Android) properties have no web stream.
 */
async function domainFor(token: string, propertyId: string): Promise<string | undefined> {
  type DataStream = { webStreamData?: { defaultUri?: string } };
  const url = ADMIN_API + "/properties/" + propertyId + "/dataStreams?pageSize=200";

  try {
    const page = await gaFetch<{ dataStreams?: DataStream[] }>(token, url);
    for (const stream of page.dataStreams ?? []) {
      const uri = stream.webStreamData?.defaultUri;
      if (!uri) continue;
      try {
        // GA stores the URI with a scheme, but tolerate a bare hostname.
        return new URL(uri.includes("://") ? uri : "https://" + uri).hostname;
      } catch {
        /* malformed URI on this stream - try the next one */
      }
    }
  } catch {
    // A property whose streams we cannot read still renders; it just keeps
    // its colour/shape swatch instead of a favicon.
  }
  return undefined;
}

/** Run tasks with bounded concurrency - Google caps concurrent Data API requests. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

// -- Realtime ----------------------------------------------------------------

export async function fetchPropertyRealtime(
  token: string,
  property: Property,
): Promise<{ summary: RealtimeProperty; points: MapPoint[]; quota?: Quota }> {
  const url = DATA_API + "/properties/" + property.id + ":runRealtimeReport";
  const geoQuery = {
    dimensions: [{ name: "countryId" }, { name: "country" }, { name: "city" }],
    metrics: [{ name: "activeUsers" }],
    limit: 250,
    returnPropertyQuota: true,
  };

  try {
    // TOTAL gives the true unique-user count. If the aggregation is ever
    // rejected, fall back to the plain query and sum the rows below.
    const geo = await gaFetch<Report>(token, url, {
      ...geoQuery,
      metricAggregations: ["TOTAL"],
    }).catch((err) => {
      if (err instanceof HttpError && err.status === 400) {
        return gaFetch<Report>(token, url, geoQuery);
      }
      throw err;
    });

    const points: MapPoint[] = [];
    for (const row of geo.rows ?? []) {
      const activeUsers = met(row, 0);
      if (activeUsers <= 0) continue;
      const where = locate(dim(row, 0), dim(row, 2));
      if (!where) continue; // unknown location: still counted in the total below
      points.push({
        propertyId: property.id,
        city: dim(row, 2) || "Unknown city",
        country: dim(row, 1) || "Unknown country",
        lat: where.lat,
        lng: where.lng,
        precision: where.precision,
        activeUsers,
      });
    }

    // The TOTAL aggregation is authoritative: summing rows would double-count
    // a user who appears under more than one dimension combination.
    const totalRow = geo.totals?.[0];
    const activeUsers = totalRow
      ? met(totalRow, 0)
      : points.reduce((sum, p) => sum + p.activeUsers, 0);

    const quota = readQuota(geo);
    const buckets = new Array(30).fill(0) as number[];

    // activeUsers counts the last 30 minutes, so zero here means every minute in
    // the pulse is also zero. Skipping that second call is lossless, and it
    // halves the request cost of an idle property - which most are, most of the
    // time.
    if (activeUsers > 0) {
      const pulse = await gaFetch<Report>(token, url, {
        dimensions: [{ name: "minutesAgo" }],
        metrics: [{ name: "activeUsers" }],
        limit: 60,
      });
      for (const row of pulse.rows ?? []) {
        const minutesAgo = num(dim(row, 0));
        if (minutesAgo >= 0 && minutesAgo < 30) buckets[29 - minutesAgo] = met(row, 0);
      }
    }

    return { summary: { propertyId: property.id, activeUsers, pulse: buckets }, points, quota };
  } catch (err) {
    return {
      summary: {
        propertyId: property.id,
        activeUsers: 0,
        pulse: new Array(30).fill(0) as number[],
        error: describe(err),
      },
      points: [],
    };
  }
}

function readQuota(report: Report): Quota | undefined {
  const hourly = report.propertyQuota?.tokensPerHour;
  if (!hourly) return undefined;
  return {
    tokensPerHourRemaining: hourly.remaining,
    tokensPerHourConsumed: hourly.consumed,
  };
}

// -- Historical --------------------------------------------------------------

const emptyTotals = (): Totals => ({
  activeUsers: 0,
  newUsers: 0,
  sessions: 0,
  screenPageViews: 0,
  averageSessionDuration: 0,
  engagementRate: 0,
});

const totalsFrom = (row: ReportRow): Totals => ({
  activeUsers: met(row, 0),
  newUsers: met(row, 1),
  sessions: met(row, 2),
  screenPageViews: met(row, 3),
  averageSessionDuration: met(row, 4),
  engagementRate: met(row, 5),
});

const namedCounts = (report: Report | undefined): NamedCount[] =>
  (report?.rows ?? [])
    .map((row) => ({ name: dim(row, 0) || "(not set)", value: met(row, 0) }))
    .filter((r) => r.value > 0);

async function statsForProperty(
  token: string,
  property: Property,
  range: RangeKey,
): Promise<PropertyStats> {
  const spec = RANGES[range];
  const current = { ...spec.current, name: "current" };
  const previous = { ...spec.previous, name: "previous" };

  try {
    const body = {
      requests: [
        {
          dateRanges: [current, previous],
          metrics: METRICS.map((name) => ({ name })),
        },
        {
          dateRanges: [current],
          dimensions: [{ name: spec.seriesDimension }],
          metrics: [{ name: "activeUsers" }, { name: "sessions" }],
          orderBys: [{ dimension: { dimensionName: spec.seriesDimension } }],
          limit: 200,
        },
        {
          dateRanges: [current],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 8,
        },
        {
          dateRanges: [current],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        },
      ],
    };

    const { reports = [] } = await gaFetch<BatchReports>(
      token,
      DATA_API + "/properties/" + property.id + ":batchRunReports",
      body,
    );

    // With two named date ranges the API appends a `dateRange` dimension whose
    // value is the range's name.
    let currentTotals = emptyTotals();
    let previousTotals = emptyTotals();
    for (const row of reports[0]?.rows ?? []) {
      if (dim(row, 0) === "previous") previousTotals = totalsFrom(row);
      else currentTotals = totalsFrom(row);
    }

    const series: SeriesPoint[] = (reports[1]?.rows ?? []).map((row) => ({
      bucket: dim(row, 0),
      activeUsers: met(row, 0),
      sessions: met(row, 1),
    }));

    return {
      propertyId: property.id,
      current: currentTotals,
      previous: previousTotals,
      series,
      topPages: namedCounts(reports[2]),
      topChannels: namedCounts(reports[3]),
    };
  } catch (err) {
    return {
      propertyId: property.id,
      current: emptyTotals(),
      previous: emptyTotals(),
      series: [],
      topPages: [],
      topChannels: [],
      error: describe(err),
    };
  }
}

export async function fetchStats(
  token: string,
  properties: Property[],
  range: RangeKey,
): Promise<PropertyStats[]> {
  return pool(properties, 5, (p) => statsForProperty(token, p, range));
}
