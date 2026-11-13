import type { NextFunction, Request, Response } from "express";
import { env } from "./env.js";

/**
 * Every host the served gtag.js can send GA4 measurement hits to. gtag.js is
 * loaded live from Google's CDN, so this set changes under us without a deploy
 * (which is how the policy silently broke once already). Note that
 * `*.example.com` never matches the apex `example.com`, so apex hosts are
 * listed on their own.
 */
const ga4Hosts = [
  "https://*.google-analytics.com", // www. and region1. collectors
  "https://analytics.google.com", // apex collector
  "https://*.analytics.google.com", // regional collectors
  "https://www.google.com", // Google-signals hit (/g/collect) and consent-mode geo lookup
  "https://stats.g.doubleclick.net", // Google-signals hit
].join(" ");

/**
 * Security headers. The app serves its own bundle plus Google Analytics 4, and
 * talks only to its own origin and GA4's collection endpoints.
 *
 * `style-src` needs 'unsafe-inline' because React sets inline style attributes;
 * scripts are files with no inline execution, so script-src stays tight.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Google Analytics 4 (gtag.js) loads from Tag Manager; its bootstrap is
      // /gtag-init.js, so no inline script is needed.
      "script-src 'self' https://*.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      // Google's favicon service (www.google.com/s2/favicons, a host already in
      // ga4Hosts) renders each property's site icon. It 301s to
      // t0-t3.gstatic.com, and CSP checks the redirect target as well. The
      // GA4 hosts also cover gtag's image-pixel fallback.
      `img-src 'self' data: https://*.gstatic.com ${ga4Hosts} https://*.googletagmanager.com`,
      "font-src 'self'",
      // The dashboard's data comes from its own API (Google is contacted
      // server-side); the browser itself only sends GA4 measurement hits.
      `connect-src 'self' ${ga4Hosts} https://*.googletagmanager.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  if (env.secureCookies) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window limiter, per IP, in memory.
 *
 * In-memory is correct here only because SQLite pins us to a single instance -
 * revisit alongside any move to Postgres and multiple replicas.
 */
export function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>();

  // Keep the map from growing without bound on a long-lived process.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }, 60_000);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Needs `trust proxy` so this is the real client, not the load balancer.
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }
    next();
  };
}
