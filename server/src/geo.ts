import cities from "all-the-cities";

export type Coords = { lat: number; lng: number };
export type Precision = "city" | "country";
export type Located = Coords & { precision: Precision };

type CityRow = {
  name: string;
  country: string;
  population: number;
  loc: { coordinates: [number, number] }; // [lon, lat]
};

/** Fold to a comparable key: lowercase, strip accents and punctuation. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Google Analytics uses its own place names; GeoNames uses others. Most gaps
 * close via the "City"-suffix and prefix rules below — these are the ones that
 * don't, because the two sources picked genuinely different names.
 */
const ALIASES: Record<string, string> = {
  kiev: "kyiv",
  bengaluru: "bangalore",
  bombay: "mumbai",
  saigon: "hochiminhcity",
  gothenburg: "goteborg",
  cologne: "koln",
  munich: "munchen",
  vienna: "wien",
  prague: "praha",
  warsaw: "warszawa",
  lisbon: "lisboa",
  brussels: "brussel",
  copenhagen: "kobenhavn",
  seville: "sevilla",
  florence: "firenze",
  naples: "napoli",
  milan: "milano",
  turin: "torino",
  genoa: "genova",
  athens: "athina",
  bucharest: "bucuresti",
  belgrade: "beograd",
  zurich: "zurich",
  geneva: "geneve",
  thehague: "sgravenhage",
  antwerp: "antwerpen",
  nuremberg: "nurnberg",
  frankfurt: "frankfurtammain",
  dusseldorf: "dusseldorf",
  taipei: "taipeh",
  macau: "macao",
};

type Index = {
  exact: Map<string, Coords & { pop: number }>;
  byCountry: Map<string, { key: string; lat: number; lng: number; pop: number }[]>;
  anchors: Map<string, Coords>;
};

let index: Index | null = null;

/** Built once, on the first geo lookup — parsing 135k cities is ~200ms. */
function build(): Index {
  const exact = new Map<string, Coords & { pop: number }>();
  const byCountry = new Map<string, { key: string; lat: number; lng: number; pop: number }[]>();
  const weights = new Map<string, { lat: number; lng: number; w: number; n: number }>();

  for (const raw of cities as unknown as CityRow[]) {
    const cc = raw.country;
    const [lng, lat] = raw.loc.coordinates;
    const pop = raw.population || 0;
    const key = `${cc}|${norm(raw.name)}`;

    const seen = exact.get(key);
    if (!seen || pop > seen.pop) exact.set(key, { lat, lng, pop });

    let list = byCountry.get(cc);
    if (!list) byCountry.set(cc, (list = []));
    list.push({ key: norm(raw.name), lat, lng, pop });

    // Weight the country anchor by population so it lands where people are,
    // not on the empty geographic middle of a large country.
    const w = weights.get(cc) ?? { lat: 0, lng: 0, w: 0, n: 0 };
    w.lat += lat * (pop || 1);
    w.lng += lng * (pop || 1);
    w.w += pop || 1;
    w.n += 1;
    weights.set(cc, w);
  }

  for (const list of byCountry.values()) list.sort((a, b) => b.pop - a.pop);

  const anchors = new Map<string, Coords>();
  for (const [cc, w] of weights) {
    if (w.w > 0) anchors.set(cc, { lat: w.lat / w.w, lng: w.lng / w.w });
  }

  return { exact, byCountry, anchors };
}

const memo = new Map<string, Located | null>();

const isBlank = (v: string | undefined) =>
  !v || v === "(not set)" || v === "(none)" || v.toLowerCase() === "unknown";

export function locate(countryId: string | undefined, city: string | undefined): Located | null {
  const cc = (countryId ?? "").toUpperCase();
  if (isBlank(cc) || cc === "ZZ") return null;

  const cacheKey = `${cc}|${city ?? ""}`;
  if (memo.has(cacheKey)) return memo.get(cacheKey)!;

  index ??= build();
  const result = resolve(cc, city);
  memo.set(cacheKey, result);
  return result;
}

function resolve(cc: string, city: string | undefined): Located | null {
  const idx = index!;
  const country = idx.anchors.get(cc);
  const fallback: Located | null = country ? { ...country, precision: "country" } : null;

  if (isBlank(city)) return fallback;

  const n = norm(city!);
  const candidates = [n, ALIASES[n], `${n}city`, n.replace(/city$/, "")].filter(
    (c): c is string => Boolean(c),
  );

  for (const candidate of candidates) {
    const hit = idx.exact.get(`${cc}|${candidate}`);
    if (hit) return { lat: hit.lat, lng: hit.lng, precision: "city" };
  }

  // Last resort inside the country: the largest place whose name contains the
  // query or vice versa ("New York" -> "New York City", "Washington" ->
  // "Washington, D.C."). The list is population-sorted, so the first hit wins.
  const list = idx.byCountry.get(cc);
  if (list && n.length >= 4) {
    for (const entry of list) {
      if (entry.key.startsWith(n) || n.startsWith(entry.key)) {
        return { lat: entry.lat, lng: entry.lng, precision: "city" };
      }
    }
  }

  return fallback;
}
