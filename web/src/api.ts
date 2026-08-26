export type Property = { id: string; name: string; account: string; slot: number };

export type MapPoint = {
  propertyId: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  activeUsers: number;
  precision: "city" | "country";
};

export type RealtimeProperty = {
  propertyId: string;
  activeUsers: number;
  pulse: number[];
  error?: string;
};

export type Realtime = {
  updatedAt: string;
  totalActiveUsers: number;
  properties: RealtimeProperty[];
  points: MapPoint[];
};

export type Totals = {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  screenPageViews: number;
  averageSessionDuration: number;
  engagementRate: number;
};

export type SeriesPoint = { bucket: string; activeUsers: number; sessions: number };
export type NamedCount = { name: string; value: number };

export type PropertyStats = {
  propertyId: string;
  current: Totals;
  previous: Totals;
  series: SeriesPoint[];
  topPages: NamedCount[];
  topChannels: NamedCount[];
  error?: string;
};

export type Stats = {
  range: string;
  rangeLabel: string;
  seriesDimension: "date" | "hour";
  updatedAt: string;
  properties: PropertyStats[];
};

export type Status = {
  /** A browser session exists (mock mode creates one automatically). */
  signedIn: boolean;
  /** This account has usable Google Analytics credentials stored. */
  connected: boolean;
  /** Serving generated data — never true once connected. */
  mock: boolean;
  oauthConfigured: boolean;
  /** False on deployed instances: credentials must come from the environment. */
  setupUiAvailable: boolean;
  redirectUri: string;
  /** Cloud project that owns the OAuth client, derived from its id. */
  projectNumber: string | null;
  email: string | null;
  name: string | null;
  ranges: { key: string; label: string }[];
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const getStatus = () => get<Status>("/api/status");
export const getProperties = () => get<{ properties: Property[] }>("/api/properties");
export const getRealtime = () => get<Realtime>("/api/realtime");
export const getStats = (range: string) =>
  get<Stats>("/api/stats?range=" + encodeURIComponent(range));

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** Writes the OAuth client to the local .env and applies it without a restart. */
export const configureOAuth = (clientId: string, clientSecret: string) =>
  post<{ ok: true }>("/api/auth/configure", { clientId, clientSecret });

export const logout = () => post<{ ok: true }>("/api/auth/logout");

/** Revoke Google access, keep the account. */
export const disconnectGoogle = () => post<{ ok: true }>("/api/auth/disconnect");

/** Erase the account and every stored token. */
export const deleteAccount = () => post<{ ok: true }>("/api/account/delete");
