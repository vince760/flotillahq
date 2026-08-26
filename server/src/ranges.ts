export type RangeKey = "today" | "7d" | "28d" | "90d";

type Span = { startDate: string; endDate: string };
export type RangeSpec = {
  label: string;
  current: Span;
  previous: Span;
  /** `hour` gives today a readable 24-point series; `date` is used elsewhere. */
  seriesDimension: "date" | "hour";
};

const span = (startDate: string, endDate: string): Span => ({ startDate, endDate });

export const RANGES: Record<RangeKey, RangeSpec> = {
  today: {
    label: "Today",
    current: span("today", "today"),
    previous: span("yesterday", "yesterday"),
    seriesDimension: "hour",
  },
  "7d": {
    label: "Last 7 days",
    current: span("6daysAgo", "today"),
    previous: span("13daysAgo", "7daysAgo"),
    seriesDimension: "date",
  },
  "28d": {
    label: "Last 28 days",
    current: span("27daysAgo", "today"),
    previous: span("55daysAgo", "28daysAgo"),
    seriesDimension: "date",
  },
  "90d": {
    label: "Last 90 days",
    current: span("89daysAgo", "today"),
    previous: span("179daysAgo", "90daysAgo"),
    seriesDimension: "date",
  },
};

export const isRangeKey = (v: unknown): v is RangeKey =>
  typeof v === "string" && v in RANGES;
