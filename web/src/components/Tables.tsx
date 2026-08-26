import type { MapPoint, Property, Stats } from "../api";
import { identityFor } from "../lib/palette";
import { compact, duration, full, percent } from "../lib/format";
import { Swatch } from "./Swatch";

/** Flatten a per-property breakdown into one ranked list. */
function ranked(
  properties: Property[],
  stats: Stats | null,
  pick: "topPages" | "topChannels",
  limit: number,
) {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const rows = (stats?.properties ?? []).flatMap((stat) => {
    const property = byId.get(stat.propertyId);
    if (!property) return [];
    return stat[pick].map((row) => ({ property, name: row.name, value: row.value }));
  });
  return rows.sort((a, b) => b.value - a.value).slice(0, limit);
}

export function TopTables({
  properties,
  stats,
}: {
  properties: Property[];
  stats: Stats | null;
}) {
  const pages = ranked(properties, stats, "topPages", 12);
  const channels = ranked(properties, stats, "topChannels", 12);

  return (
    <div className="panels">
      <Panel title="Top pages" head="Page" metric="Views" rows={pages} />
      <Panel title="Top channels" head="Channel" metric="Sessions" rows={channels} />
    </div>
  );
}

function Panel({
  title,
  head,
  metric,
  rows,
}: {
  title: string;
  head: string;
  metric: string;
  rows: { property: Property; name: string; value: number }[];
}) {
  return (
    <div className="card panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "6px 0 12px" }}>
          No data for this period.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th className="swatch-cell" aria-label="Property colour" />
                <th>Property</th>
                <th>{head}</th>
                <th className="num">{metric}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.property.id + "|" + row.name + "|" + i}>
                  <td className="swatch-cell">
                    <Swatch identity={identityFor(row.property.slot)} size={12} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.property.name}</td>
                  <td className="truncate" title={row.name}>
                    {row.name}
                  </td>
                  <td className="num" title={full(row.value)}>
                    {compact(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The map's table twin. Every figure the map encodes as position, size, colour
 * and shape is also readable here as plain text.
 */
export function LocationTable({
  points,
  properties,
  hidden,
}: {
  points: MapPoint[];
  properties: Property[];
  hidden: Set<string>;
}) {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const rows = points
    .filter((p) => !hidden.has(p.propertyId) && byId.has(p.propertyId))
    .sort((a, b) => b.activeUsers - a.activeUsers);

  return (
    <div className="card panel" style={{ paddingBottom: 14 }}>
      <h3>Live viewers by location</h3>
      {rows.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No live viewers right now.</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th className="swatch-cell" aria-label="Property colour" />
                <th>Property</th>
                <th>City</th>
                <th>Country</th>
                <th className="num">Live viewers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const property = byId.get(row.propertyId)!;
                return (
                  <tr key={row.propertyId + row.city + i}>
                    <td className="swatch-cell">
                      <Swatch identity={identityFor(property.slot)} size={12} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{property.name}</td>
                    <td>
                      {row.city}
                      {row.precision === "country" ? (
                        <span style={{ color: "var(--muted)" }} title="Placed at the country level">
                          {" "}
                          (approx.)
                        </span>
                      ) : null}
                    </td>
                    <td>{row.country}</td>
                    <td className="num">{full(row.activeUsers)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Table twin for the trend cards: every sparkline's totals in text form. */
export function TotalsTable({
  properties,
  stats,
}: {
  properties: Property[];
  stats: Stats | null;
}) {
  const statsById = new Map(stats?.properties.map((p) => [p.propertyId, p]) ?? []);

  return (
    <div className="card panel" style={{ paddingBottom: 14 }}>
      <h3>{stats?.rangeLabel ?? "Totals"} by property</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th className="swatch-cell" aria-label="Property colour" />
              <th>Property</th>
              <th className="num">Users</th>
              <th className="num">Prev. users</th>
              <th className="num">New users</th>
              <th className="num">Sessions</th>
              <th className="num">Views</th>
              <th className="num">Engagement</th>
              <th className="num">Avg session</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => {
              const stat = statsById.get(property.id);
              return (
                <tr key={property.id}>
                  <td className="swatch-cell">
                    <Swatch identity={identityFor(property.slot)} size={12} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{property.name}</td>
                  <td className="num">{stat ? full(stat.current.activeUsers) : "—"}</td>
                  <td className="num">{stat ? full(stat.previous.activeUsers) : "—"}</td>
                  <td className="num">{stat ? full(stat.current.newUsers) : "—"}</td>
                  <td className="num">{stat ? full(stat.current.sessions) : "—"}</td>
                  <td className="num">{stat ? full(stat.current.screenPageViews) : "—"}</td>
                  <td className="num">{stat ? percent(stat.current.engagementRate) : "—"}</td>
                  <td className="num">
                    {stat ? duration(stat.current.averageSessionDuration) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
