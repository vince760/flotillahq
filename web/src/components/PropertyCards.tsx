import type { Property, PropertyStats, Realtime, Stats } from "../api";
import { identityFor } from "../lib/palette";
import { bucketLabel, compact, delta, duration, full, percent } from "../lib/format";
import { Sparkline } from "./Sparkline";
import { Swatch } from "./Swatch";

type Props = {
  properties: Property[];
  stats: Stats | null;
  realtime: Realtime | null;
};

/**
 * Small multiples, one card per property. Each card carries a single series, so
 * it needs no legend of its own and never puts two hues on one plot - which is
 * what keeps identity readable no matter how many properties there are.
 */
export function PropertyCards({ properties, stats, realtime }: Props) {
  const statsById = new Map(stats?.properties.map((p) => [p.propertyId, p]) ?? []);
  const liveById = new Map(realtime?.properties.map((p) => [p.propertyId, p]) ?? []);
  const dimension = stats?.seriesDimension ?? "date";

  return (
    <div className="cards">
      {properties.map((property) => {
        const identity = identityFor(property.slot);
        const stat = statsById.get(property.id);
        const live = liveById.get(property.id);

        return (
          <div className="card pcard" key={property.id}>
            <div className="pcard-head">
              <Swatch identity={identity} size={16} title={identity.shape} />
              <div className="title">
                <div className="name" title={property.name}>
                  {property.name}
                </div>
                {property.account ? <div className="account">{property.account}</div> : null}
              </div>
              <div className="pcard-live" title="Viewers active in the last 30 minutes">
                <b>{full(live?.activeUsers ?? 0)}</b>
                <span>live</span>
              </div>
            </div>

            {stat?.error ? (
              <div className="pcard-error">
                <span aria-hidden="true">⚠</span>
                <span>{stat.error}</span>
              </div>
            ) : (
              <CardBody stat={stat} color={identity.color} dimension={dimension} name={property.name} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CardBody({
  stat,
  color,
  dimension,
  name,
}: {
  stat: PropertyStats | undefined;
  color: string;
  dimension: "date" | "hour";
  name: string;
}) {
  if (!stat) {
    return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>;
  }

  const values = stat.series.map((p) => p.activeUsers);
  const labels = stat.series.map((p) => bucketLabel(p.bucket, dimension));
  const change = delta(stat.current.activeUsers, stat.previous.activeUsers);

  return (
    <>
      <Sparkline
        values={values}
        labels={labels}
        color={color}
        ariaLabel={`Users over the selected period for ${name}`}
      />

      <div className="pcard-metrics">
        <div className="metric">
          <div className="k">Users</div>
          <div className="v" title={full(stat.current.activeUsers)}>
            {compact(stat.current.activeUsers)}
          </div>
          {change ? (
            <div
              className={"delta " + (change.direction === "up" ? "up" : change.direction === "down" ? "down" : "")}
              style={{ marginTop: 0 }}
            >
              <span className="arrow" aria-hidden="true">
                {change.direction === "up" ? "▲" : change.direction === "down" ? "▼" : "■"}
              </span>
              <span>{change.text}</span>
            </div>
          ) : null}
        </div>
        <div className="metric">
          <div className="k">Sessions</div>
          <div className="v" title={full(stat.current.sessions)}>
            {compact(stat.current.sessions)}
          </div>
        </div>
        <div className="metric">
          <div className="k">Views</div>
          <div className="v" title={full(stat.current.screenPageViews)}>
            {compact(stat.current.screenPageViews)}
          </div>
        </div>
      </div>

      <div style={{ color: "var(--muted)", fontSize: 11.5 }}>
        Engagement {percent(stat.current.engagementRate)} · Avg session{" "}
        {duration(stat.current.averageSessionDuration)}
      </div>
    </>
  );
}
