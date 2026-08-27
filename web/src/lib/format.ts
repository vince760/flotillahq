/** Compact for display (1,284 / 12.9K / 4.2M), full precision on hover. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const n = Math.round(value);
  if (Math.abs(n) < 10000) return n.toLocaleString();
  if (Math.abs(n) < 1_000_000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "K";
  return (n / 1_000_000).toFixed(1) + "M";
}

export const full = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : "-";

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? m + "m " + s + "s" : s + "s";
}

export const percent = (ratio: number): string =>
  Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + "%" : "-";

export type Delta = { text: string; direction: "up" | "down" | "flat" };

/** Percentage change vs the previous period; null when there is no baseline. */
export function delta(current: number, previous: number): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.001) return { text: "0%", direction: "flat" };
  const sign = change > 0 ? "+" : "−";
  return {
    text: sign + Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0) + "%",
    direction: change > 0 ? "up" : "down",
  };
}

/** GA4 hands back YYYYMMDD for dates and HH for hours. */
export function bucketLabel(bucket: string, dimension: "date" | "hour"): string {
  if (dimension === "hour") return bucket.padStart(2, "0") + ":00";
  if (!/^\d{8}$/.test(bucket)) return bucket;
  const date = new Date(
    Number(bucket.slice(0, 4)),
    Number(bucket.slice(4, 6)) - 1,
    Number(bucket.slice(6, 8)),
  );
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
