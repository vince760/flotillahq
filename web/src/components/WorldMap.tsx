import { useMemo, useRef, useState } from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import topology from "world-atlas/countries-110m.json";
import type { MapPoint, Property } from "../api";
import { identityFor, shapePath, type Identity } from "../lib/palette";
import { full } from "../lib/format";
import { useMeasure } from "../lib/useMeasure";

const world = topology as unknown as Topology;
const LAND = feature(
  world,
  world.objects.countries as GeometryCollection,
) as FeatureCollection<Geometry>;

const MARGIN = 8;
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;

type Entry = { property: Property; identity: Identity; activeUsers: number };
type Group = {
  key: string;
  city: string;
  country: string;
  px: number;
  py: number;
  total: number;
  entries: Entry[];
};

type Transform = { k: number; x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Area-proportional, with a floor so a single viewer is still a visible mark. */
const radiusFor = (users: number) => clamp(2.5 + Math.sqrt(users), 2.5, 11);

type Props = {
  points: MapPoint[];
  properties: Property[];
  hidden: Set<string>;
  loading: boolean;
};

export function WorldMap({ points, properties, hidden, loading }: Props) {
  const [ref, { width, height }] = useMeasure<HTMLDivElement>();
  const [transform, setTransform] = useState<Transform>({ k: 1, x: 0, y: 0 });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const w = Math.max(width, 1);
  const h = Math.max(height, 1);

  const projection = useMemo(
    () =>
      geoEqualEarth().fitExtent(
        [
          [MARGIN, MARGIN],
          [Math.max(w - MARGIN, MARGIN + 1), Math.max(h - MARGIN, MARGIN + 1)],
        ],
        { type: "Sphere" },
      ),
    [w, h],
  );

  const paths = useMemo(() => {
    const draw = geoPath(projection);
    return {
      sphere: draw({ type: "Sphere" }) ?? "",
      countries: LAND.features.map((f, i) => ({ id: i, d: draw(f) ?? "" })),
    };
  }, [projection]);

  const byId = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const groups = useMemo<Group[]>(() => {
    const buckets = new Map<string, Group>();

    for (const point of points) {
      if (hidden.has(point.propertyId)) continue;
      const property = byId.get(point.propertyId);
      if (!property) continue;

      const projected = projection([point.lng, point.lat]);
      if (!projected) continue;

      const key = point.lat.toFixed(3) + "," + point.lng.toFixed(3);
      let group = buckets.get(key);
      if (!group) {
        group = {
          key,
          city: point.city,
          country: point.country,
          px: projected[0],
          py: projected[1],
          total: 0,
          entries: [],
        };
        buckets.set(key, group);
      }
      group.total += point.activeUsers;
      group.entries.push({
        property,
        identity: identityFor(property.slot),
        activeUsers: point.activeUsers,
      });
    }

    for (const group of buckets.values()) {
      group.entries.sort((a, b) => b.activeUsers - a.activeUsers);
    }
    // Biggest first so small markers land on top and stay clickable.
    return [...buckets.values()].sort((a, b) => b.total - a.total);
  }, [points, hidden, byId, projection]);

  // Keep the map covering the viewport: at k=1 it exactly fits.
  const limit = (t: Transform): Transform => ({
    k: t.k,
    x: clamp(t.x, w - w * t.k, 0),
    y: clamp(t.y, h - h * t.k, 0),
  });

  function zoomAbout(cx: number, cy: number, factor: number) {
    setTransform((prev) => {
      const k = clamp(prev.k * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = k / prev.k;
      return limit({ k, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio });
    });
  }

  function onWheel(event: React.WheelEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    zoomAbout(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * 0.0015));
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: transform.x, oy: transform.y };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start) return;
    setTransform((prev) =>
      limit({
        k: prev.k,
        x: start.ox + (event.clientX - start.x),
        y: start.oy + (event.clientY - start.y),
      }),
    );
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
  }

  const screen = (group: Group) => ({
    x: group.px * transform.k + transform.x,
    y: group.py * transform.k + transform.y,
  });

  const hovered = groups.find((g) => g.key === hoverKey) ?? null;
  const totalLive = groups.reduce((sum, g) => sum + g.total, 0);

  return (
    <div ref={ref} className="map-card card" style={{ position: "relative" }}>
      <div className="map-toolbar">
        <button className="icon-btn" onClick={() => zoomAbout(w / 2, h / 2, 1.5)} aria-label="Zoom in">
          +
        </button>
        <button
          className="icon-btn"
          onClick={() => zoomAbout(w / 2, h / 2, 1 / 1.5)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="icon-btn"
          onClick={() => setTransform({ k: 1, x: 0, y: 0 })}
          aria-label="Reset the map view"
          title="Reset view"
        >
          ⤢
        </button>
      </div>

      <svg
        className={"map-svg" + (dragging ? " dragging" : "")}
        viewBox={`0 0 ${w} ${h}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label={`World map of live viewers: ${full(totalLive)} across ${groups.length} locations. The table view lists the same figures.`}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          <path d={paths.sphere} fill="var(--surface-1)" />
          {paths.countries.map((c) => (
            <path
              key={c.id}
              d={c.d}
              fill="var(--land)"
              stroke="var(--land-stroke)"
              strokeWidth={0.5 / transform.k}
            />
          ))}
        </g>

        {/* Markers live outside the zoom group so they keep a constant screen size. */}
        <g>
          {groups.map((group) => {
            const { x, y } = screen(group);
            if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return null;

            const count = group.entries.length;
            const radii = group.entries.map((e) => radiusFor(e.activeUsers));
            const maxR = Math.max(...radii);
            // Co-located properties fan out around the point instead of hiding
            // one another.
            const ring = count === 1 ? 0 : Math.max(9, maxR * 0.9);
            const isHovered = group.key === hoverKey;

            return (
              <g key={group.key} transform={`translate(${x} ${y})`}>
                {group.entries.map((entry, i) => {
                  const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                  const dx = ring * Math.cos(angle);
                  const dy = ring * Math.sin(angle);
                  return (
                    <path
                      key={entry.property.id}
                      // Always a circle: colour alone carries identity on the
                      // map, the marker shapes read as noise at these sizes.
                      d={shapePath("circle", radii[i])}
                      transform={`translate(${dx} ${dy})`}
                      fill={entry.identity.color}
                      fillOpacity={0.92}
                      stroke="var(--surface-1)"
                      strokeWidth={2}
                      style={{ pointerEvents: "none" }}
                    />
                  );
                })}

                {/* Hit target is deliberately larger than the marks. */}
                <circle
                  r={Math.max(14, ring + maxR)}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${group.city}, ${group.country}: ${full(group.total)} live viewers`}
                  onPointerEnter={() => setHoverKey(group.key)}
                  onPointerLeave={() => setHoverKey((k) => (k === group.key ? null : k))}
                  onFocus={() => setHoverKey(group.key)}
                  onBlur={() => setHoverKey((k) => (k === group.key ? null : k))}
                />

                {isHovered ? (
                  <circle
                    r={Math.max(14, ring + maxR)}
                    fill="none"
                    stroke="var(--axis)"
                    strokeWidth={1}
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {hovered ? <MapTooltip group={hovered} at={screen(hovered)} width={w} /> : null}

      {groups.length === 0 ? (
        <div className="map-empty">
          {loading ? "Loading live viewers…" : "No live viewers right now."}
        </div>
      ) : null}
    </div>
  );
}

function MapTooltip({ group, at, width }: { group: Group; at: { x: number; y: number }; width: number }) {
  const left = clamp(at.x + 16, 8, Math.max(width - 250, 8));
  return (
    <div className="tip" style={{ left, top: at.y + 14 }}>
      <div className="head">
        {group.city}
        <span className="sub"> · {group.country}</span>
      </div>
      {group.entries.map((entry) => (
        <div className="row" key={entry.property.id}>
          <svg width={12} height={10} aria-hidden="true">
            <line
              x1={0}
              y1={5}
              x2={12}
              y2={5}
              stroke={entry.identity.color}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </svg>
          <span className="n">{entry.property.name}</span>
          <span className="v">{full(entry.activeUsers)}</span>
        </div>
      ))}
      {group.entries.length > 1 ? (
        <div className="row" style={{ borderTop: "1px solid var(--grid)", marginTop: 4, paddingTop: 4 }}>
          <span />
          <span className="n">Total</span>
          <span className="v">{full(group.total)}</span>
        </div>
      ) : null}
    </div>
  );
}
