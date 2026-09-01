import { useState } from "react";
import type { Property } from "../api";

/**
 * Google's favicon service - the tracked site is never contacted directly,
 * and the service answers with a generic globe when a site has no icon of its
 * own. Always requests 64px; callers scale down so icons stay crisp on
 * high-DPI screens.
 */
export const faviconUrl = (domain: string) =>
  "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=64";

/**
 * Generic "website" globe, the default mark when a property has no favicon.
 * Bare SVG elements so it can be dropped straight into the map's SVG as well
 * as wrapped in its own <svg> for HTML contexts.
 */
export function GlobeMark({ r, stroke = "var(--muted)" }: { r: number; stroke?: string }) {
  return (
    <g fill="none" stroke={stroke} strokeWidth={Math.max(1, r * 0.18)}>
      <circle r={r} />
      <ellipse rx={r * 0.45} ry={r} />
      <line x1={-r} x2={r} y1={0} y2={0} />
    </g>
  );
}

type Props = {
  property: Property;
  size?: number;
  /**
   * Without a favicon: "globe" shows the default site glyph, "spacer" holds
   * the layout slot open (for grids that already carry an identity swatch).
   */
  fallback?: "globe" | "spacer";
};

/**
 * The property's favicon. App-only properties (no web stream, so no domain)
 * and failed loads render the fallback instead.
 */
export function SiteIcon({ property, size = 14, fallback = "globe" }: Props) {
  const [failed, setFailed] = useState(false);

  if (!property.domain || failed) {
    if (fallback === "spacer") {
      return <span aria-hidden="true" style={{ width: size, height: size }} />;
    }
    return (
      <svg
        className="site-icon"
        width={size}
        height={size}
        viewBox="-9 -9 18 18"
        role="img"
        aria-label="No site icon"
      >
        <GlobeMark r={8} />
      </svg>
    );
  }

  return (
    <img
      className="site-icon"
      src={faviconUrl(property.domain)}
      width={size}
      height={size}
      alt=""
      title={property.domain}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
