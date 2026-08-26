/** As returned by Google, before this user's colour slot is attached. */
export type PropertySummary = {
  id: string; // numeric GA4 property id, e.g. "123456789"
  name: string;
  account: string;
};

export type Property = PropertySummary & {
  slot: number; // stable per-user identity slot -> colour + marker shape
};

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
  /** Active users per minute for the last 30 minutes, oldest first. */
  pulse: number[];
  error?: string;
};

export type RealtimePayload = {
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

export type StatsPayload = {
  range: string;
  rangeLabel: string;
  seriesDimension: "date" | "hour";
  updatedAt: string;
  properties: PropertyStats[];
};
