import type { Property, Realtime } from "../api";
import { identityFor } from "../lib/palette";
import { clockTime, full } from "../lib/format";
import { SiteIcon } from "./SiteIcon";
import { Swatch } from "./Swatch";

type Props = {
  properties: Property[];
  realtime: Realtime | null;
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
};

/**
 * Hero figure + legend. The legend is the dependable identity channel: every
 * property is named next to the exact mark used on the map, so nothing depends
 * on matching colours by eye.
 */
export function LivePanel({ properties, realtime, hidden, onToggle, onShowAll }: Props) {
  const liveById = new Map(realtime?.properties.map((p) => [p.propertyId, p]) ?? []);
  const visibleTotal = properties
    .filter((p) => !hidden.has(p.id))
    .reduce((sum, p) => sum + (liveById.get(p.id)?.activeUsers ?? 0), 0);

  const filtered = hidden.size > 0;

  // Unlike the cards and tables, the legend keeps its swatch: it is the one
  // place that ties a property's name to the exact mark drawn on the map. The
  // favicon joins it as a second column instead of replacing it, and only when
  // at least one property has a domain, so all-app accounts lose no width.
  const showIcons = properties.some((p) => p.domain);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="hero">
        <div className="label">Live viewers{filtered ? " (shown)" : ""}</div>
        <div className="value">{full(visibleTotal)}</div>
        <div className="note">
          across {properties.length - hidden.size} of {properties.length}{" "}
          {properties.length === 1 ? "property" : "properties"}
          {realtime ? " · updated " + clockTime(realtime.updatedAt) : ""}
        </div>
      </div>

      <div className="legend">
        {properties.map((property) => {
          const identity = identityFor(property.slot);
          const live = liveById.get(property.id);
          const off = hidden.has(property.id);

          return (
            <button
              key={property.id}
              className={"legend-row" + (off ? " off" : "") + (showIcons ? " icons" : "")}
              onClick={() => onToggle(property.id)}
              aria-pressed={!off}
              title={off ? "Show on map" : "Hide from map"}
            >
              {/* Circle to match the map, which no longer draws shape variants. */}
              <Swatch identity={{ ...identity, shape: "circle" }} size={16} />
              {showIcons ? <SiteIcon property={property} size={16} fallback="spacer" /> : null}
              <span className="name">
                {property.name}
                {property.account ? <span className="account">{property.account}</span> : null}
              </span>
              <span className="count">
                {live?.error ? (
                  <span title={live.error} style={{ color: "var(--critical)" }}>
                    !
                  </span>
                ) : (
                  full(live?.activeUsers ?? 0)
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="legend-foot">
        <span>Click a property to hide it from the map.</span>
        {filtered ? (
          <button
            className="btn"
            style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 12 }}
            onClick={onShowAll}
          >
            Show all
          </button>
        ) : null}
      </div>
    </div>
  );
}
