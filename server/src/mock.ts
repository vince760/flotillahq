import { locate } from "./geo.js";
import { RANGES, type RangeKey } from "./ranges.js";
import type {
  MapPoint,
  PropertySummary,
  Property,
  PropertyStats,
  RealtimePayload,
  SeriesPoint,
} from "./types.js";

/**
 * Everything below feeds MOCK=1 mode, which runs the entire dashboard without a
 * Google account. It is the demo path and the manual test fixture - nothing here
 * is used when real credentials are configured.
 */

// "Northwind App" deliberately has no domain: it plays the app-only property,
// so the swatch fallback stays visible in the demo.
const MOCK_PROPERTIES: PropertySummary[] = [
  { id: "900000001", name: "Acme Storefront", account: "Acme Group", domain: "shop.example.com" },
  { id: "900000002", name: "Acme Docs", account: "Acme Group", domain: "docs.example.com" },
  { id: "900000003", name: "Acme Blog", account: "Acme Group", domain: "blog.example.com" },
  { id: "900000004", name: "Northwind App", account: "Northwind" },
  { id: "900000005", name: "Northwind Marketing", account: "Northwind", domain: "northwind.example" },
  { id: "900000006", name: "Contoso Labs", account: "Contoso", domain: "labs.contoso.example" },
];

const CITIES: { countryId: string; country: string; city: string; weight: number }[] = [
  { countryId: "US", country: "United States", city: "New York", weight: 10 },
  { countryId: "US", country: "United States", city: "San Francisco", weight: 8 },
  { countryId: "US", country: "United States", city: "Chicago", weight: 5 },
  { countryId: "US", country: "United States", city: "Austin", weight: 4 },
  { countryId: "GB", country: "United Kingdom", city: "London", weight: 9 },
  { countryId: "GB", country: "United Kingdom", city: "Manchester", weight: 3 },
  { countryId: "DE", country: "Germany", city: "Berlin", weight: 6 },
  { countryId: "DE", country: "Germany", city: "Munich", weight: 4 },
  { countryId: "FR", country: "France", city: "Paris", weight: 6 },
  { countryId: "NL", country: "Netherlands", city: "Amsterdam", weight: 4 },
  { countryId: "ES", country: "Spain", city: "Madrid", weight: 4 },
  { countryId: "IT", country: "Italy", city: "Milan", weight: 3 },
  { countryId: "PL", country: "Poland", city: "Warsaw", weight: 3 },
  { countryId: "IN", country: "India", city: "Bengaluru", weight: 8 },
  { countryId: "IN", country: "India", city: "Mumbai", weight: 5 },
  { countryId: "SG", country: "Singapore", city: "Singapore", weight: 4 },
  { countryId: "JP", country: "Japan", city: "Tokyo", weight: 5 },
  { countryId: "AU", country: "Australia", city: "Sydney", weight: 4 },
  { countryId: "BR", country: "Brazil", city: "Sao Paulo", weight: 5 },
  { countryId: "CA", country: "Canada", city: "Toronto", weight: 4 },
  { countryId: "ZA", country: "South Africa", city: "Cape Town", weight: 2 },
  { countryId: "AE", country: "United Arab Emirates", city: "Dubai", weight: 3 },
];

/** Deterministic PRNG so a given seed always renders the same picture. */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export function mockProperties(): PropertySummary[] {
  return MOCK_PROPERTIES.map((p) => ({ ...p }));
}

export function mockRealtime(properties: Property[]): RealtimePayload {
  // Rotates slowly so the dashboard visibly ticks between refreshes.
  const tick = Math.floor(Date.now() / 20000);
  const points: MapPoint[] = [];
  const summaries = [];

  for (const property of properties) {
    const random = rng(hash(property.id) + tick);
    const reach = 0.35 + random() * 0.5; // how global this property is
    let total = 0;

    for (const place of CITIES) {
      if (random() > reach) continue;
      const users = Math.round(place.weight * (0.2 + random() * 1.6));
      if (users <= 0) continue;
      const where = locate(place.countryId, place.city);
      if (!where) continue;
      total += users;
      points.push({
        propertyId: property.id,
        city: place.city,
        country: place.country,
        lat: where.lat,
        lng: where.lng,
        precision: where.precision,
        activeUsers: users,
      });
    }

    const pulse = Array.from({ length: 30 }, (_, i) => {
      const drift = Math.sin((tick + i) / 6) * 0.25 + 1;
      return Math.max(0, Math.round((total / 4) * drift * (0.6 + random() * 0.8)));
    });

    summaries.push({ propertyId: property.id, activeUsers: total, pulse });
  }

  return {
    updatedAt: new Date().toISOString(),
    totalActiveUsers: summaries.reduce((sum, s) => sum + s.activeUsers, 0),
    properties: summaries,
    points,
  };
}

const PAGES = [
  "/",
  "/pricing",
  "/docs/getting-started",
  "/blog/whats-new",
  "/features",
  "/changelog",
  "/support",
  "/signup",
];
const CHANNELS = [
  "Organic Search",
  "Direct",
  "Referral",
  "Organic Social",
  "Email",
  "Paid Search",
  "Display",
];

export function mockStats(properties: Property[], range: RangeKey): PropertyStats[] {
  const spec = RANGES[range];
  const buckets = spec.seriesDimension === "hour" ? 24 : range === "7d" ? 7 : range === "28d" ? 28 : 90;

  return properties.map((property) => {
    const random = rng(hash(property.id + range));
    const scale = 200 + random() * 3000;

    const series: SeriesPoint[] = Array.from({ length: buckets }, (_, i) => {
      // A weekly rhythm plus a gentle upward drift reads like real traffic.
      const weekly = 1 + Math.sin((i / buckets) * Math.PI * (buckets / 7)) * 0.25;
      const trend = 1 + (i / buckets) * 0.35;
      const users = Math.round((scale / buckets) * weekly * trend * (0.7 + random() * 0.6));
      const bucket =
        spec.seriesDimension === "hour"
          ? String(i).padStart(2, "0")
          : bucketDate(buckets - 1 - i);
      return { bucket, activeUsers: users, sessions: Math.round(users * (1.1 + random() * 0.5)) };
    });

    const activeUsers = series.reduce((sum, p) => sum + p.activeUsers, 0);
    const sessions = series.reduce((sum, p) => sum + p.sessions, 0);
    const current = {
      activeUsers,
      newUsers: Math.round(activeUsers * (0.35 + random() * 0.25)),
      sessions,
      screenPageViews: Math.round(sessions * (1.8 + random() * 1.4)),
      averageSessionDuration: 45 + random() * 220,
      engagementRate: 0.35 + random() * 0.45,
    };
    const swing = 0.78 + random() * 0.4;
    const previous = {
      activeUsers: Math.round(current.activeUsers * swing),
      newUsers: Math.round(current.newUsers * swing),
      sessions: Math.round(current.sessions * swing),
      screenPageViews: Math.round(current.screenPageViews * swing),
      averageSessionDuration: current.averageSessionDuration * (0.85 + random() * 0.3),
      engagementRate: current.engagementRate * (0.9 + random() * 0.2),
    };

    return {
      propertyId: property.id,
      current,
      previous,
      series,
      topPages: PAGES.map((name) => ({
        name,
        value: Math.round(current.screenPageViews * (0.02 + random() * 0.22)),
      }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
      topChannels: CHANNELS.map((name) => ({
        name,
        value: Math.round(current.sessions * (0.03 + random() * 0.3)),
      }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 7),
    };
  });
}

/** GA4 returns dates as YYYYMMDD; mirror that so the client parses one format. */
function bucketDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return (
    String(d.getUTCFullYear()) +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0")
  );
}
