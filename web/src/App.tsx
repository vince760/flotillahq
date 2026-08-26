import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProperties,
  getRealtime,
  getStats,
  getStatus,
  logout,
  disconnectGoogle,
  deleteAccount,
  type Property,
  type Realtime,
  type Stats,
  type Status,
} from "./api";
import { WorldMap } from "./components/WorldMap";
import { LivePanel } from "./components/LivePanel";
import { PropertyCards } from "./components/PropertyCards";
import { StatTile } from "./components/StatTile";
import { LocationTable, TopTables, TotalsTable } from "./components/Tables";
import { ConnectPanel } from "./components/ConnectPanel";
import { compact, duration, full, percent } from "./lib/format";

const REALTIME_MS = 20_000;
const STATS_MS = 5 * 60_000;

type Theme = "system" | "light" | "dark";

const COMPARISON: Record<string, string> = {
  today: "yesterday",
  "7d": "previous 7 days",
  "28d": "previous 28 days",
  "90d": "previous 90 days",
};

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [realtime, setRealtime] = useState<Realtime | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [range, setRange] = useState("7d");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme | null) ?? "system",
  );
  const [mapView, setMapView] = useState<"map" | "table">("map");
  const [trendView, setTrendView] = useState<"cards" | "table">("cards");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState({ realtime: false, stats: false });
  const [showSetup, setShowSetup] = useState(false);
  const [authOutcome, setAuthOutcome] = useState<string | null>(null);

  // -- theme -----------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // -- bootstrap -------------------------------------------------------------
  useEffect(() => {
    // Clean the ?auth=ok the OAuth callback leaves behind.
    const outcome = new URLSearchParams(location.search).get("auth");
    if (outcome) {
      setAuthOutcome(outcome);
      history.replaceState({}, "", location.pathname);
    }
    getStatus().then(setStatus).catch((e: Error) => setError(e.message));
  }, []);

  // Data is available when a session exists and it is either connected to
  // Google or running on demo data.
  const ready = Boolean(status?.signedIn && (status.connected || status.mock));

  /**
   * Retryable on its own. The property list is fetched once per session, so a
   * transient failure here (an API not yet enabled, say) used to strand the
   * dashboard with an empty list that no button could refill.
   */
  const loadProperties = useCallback(async () => {
    try {
      const result = await getProperties();
      setProperties(result.properties);
      return result.properties.length;
    } catch (e) {
      setError((e as Error).message);
      return 0;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadProperties();
  }, [ready, loadProperties]);

  // -- data --------------------------------------------------------------
  const loadRealtime = useCallback(async () => {
    setBusy((b) => ({ ...b, realtime: true }));
    try {
      setRealtime(await getRealtime());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, realtime: false }));
    }
  }, []);

  const loadStats = useCallback(async (key: string) => {
    setBusy((b) => ({ ...b, stats: true }));
    try {
      setStats(await getStats(key));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, stats: false }));
    }
  }, []);

  usePoll(loadRealtime, REALTIME_MS, ready && properties.length > 0);

  useEffect(() => {
    if (!ready || properties.length === 0) return;
    void loadStats(range);
    const id = setInterval(() => void loadStats(range), STATS_MS);
    return () => clearInterval(id);
  }, [ready, properties.length, range, loadStats]);

  // -- derived ---------------------------------------------------------------
  const totals = useMemo(() => {
    const blank = {
      activeUsers: 0,
      newUsers: 0,
      sessions: 0,
      screenPageViews: 0,
      engagementWeighted: 0,
      durationWeighted: 0,
    };
    const current = { ...blank };
    const previous = { ...blank };

    for (const stat of stats?.properties ?? []) {
      current.activeUsers += stat.current.activeUsers;
      current.newUsers += stat.current.newUsers;
      current.sessions += stat.current.sessions;
      current.screenPageViews += stat.current.screenPageViews;
      current.engagementWeighted += stat.current.engagementRate * stat.current.sessions;
      current.durationWeighted += stat.current.averageSessionDuration * stat.current.sessions;

      previous.activeUsers += stat.previous.activeUsers;
      previous.newUsers += stat.previous.newUsers;
      previous.sessions += stat.previous.sessions;
      previous.screenPageViews += stat.previous.screenPageViews;
      previous.engagementWeighted += stat.previous.engagementRate * stat.previous.sessions;
      previous.durationWeighted += stat.previous.averageSessionDuration * stat.previous.sessions;
    }

    // Rates are session-weighted; a plain mean would let a tiny property swing it.
    const rate = (t: typeof current, key: "engagementWeighted" | "durationWeighted") =>
      t.sessions > 0 ? t[key] / t.sessions : 0;

    return {
      current,
      previous,
      currentEngagement: rate(current, "engagementWeighted"),
      previousEngagement: rate(previous, "engagementWeighted"),
      currentDuration: rate(current, "durationWeighted"),
      previousDuration: rate(previous, "durationWeighted"),
    };
  }, [stats]);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Retry means retry everything — the failure could be in any of the three. */
  const retryAll = useCallback(async () => {
    setError(null);
    const count = await loadProperties();
    if (count > 0) {
      await Promise.all([loadRealtime(), loadStats(range)]);
    }
  }, [loadProperties, loadRealtime, loadStats, range]);

  /** Irreversible, so it asks twice and says exactly what goes. */
  const removeAccount = useCallback(async () => {
    const warning = [
      "Delete your account?",
      "",
      "This removes your account, your stored Google connection, your saved colours",
      "and all sessions, and revokes this app's access to your Google Analytics.",
      "",
      "It cannot be undone. Your Analytics data itself is not touched.",
    ].join("\n");
    if (!window.confirm(warning)) return;
    if (!window.confirm("Last chance — permanently delete your account?")) return;
    try {
      await deleteAccount();
      window.location.href = "/about";
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const comparison = COMPARISON[range] ?? "previous period";
  const points = realtime?.points ?? [];

  // -- render ----------------------------------------------------------------
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Flotilla</h1>
          <span className="sub">every Google Analytics property, one screen</span>
        </div>

        {ready ? (
          <span className="chip live">
            <span className={"pip" + (busy.realtime ? "" : " beating")} />
            {full(realtime?.totalActiveUsers ?? 0)} live now
          </span>
        ) : null}

        {status?.email ? <span className="chip">{status.email}</span> : null}

        {status && !status.connected ? (
          <button className="btn primary" onClick={() => setShowSetup(true)}>
            Connect Google Analytics
          </button>
        ) : null}

        <button
          className="btn"
          onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
          title={"Theme: " + theme}
        >
          {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto"}
        </button>

        {status?.connected ? (
          <button
            className="btn"
            title="Revoke this app's access to your Google Analytics"
            onClick={async () => {
              await disconnectGoogle();
              location.reload();
            }}
          >
            Disconnect
          </button>
        ) : null}

        {status?.signedIn && !status.mock ? (
          <button
            className="btn"
            onClick={async () => {
              await logout();
              location.reload();
            }}
          >
            Sign out
          </button>
        ) : null}
      </header>

      {status && showSetup ? (
        <ConnectPanel
          status={status}
          onClose={() => setShowSetup(false)}
          onConfigured={() => {
            // Credentials are live server-side now; go straight to Google.
            window.location.href = "/api/auth/login";
          }}
        />
      ) : null}

      {status && !status.connected && !showSetup ? (
        <div className="card banner" style={{ marginBottom: 16 }}>
          <div className="body">
            <h3>{status.mock ? "You are looking at generated data" : "Not connected yet"}</h3>
            <p>
              {status.mock
                ? "These six properties are fake, so you can see the layout. Connect your Google account to load your real Analytics properties."
                : "Connect the Google account that can see your Analytics properties."}
            </p>
          </div>
          <button className="btn primary" onClick={() => setShowSetup(true)}>
            {status.oauthConfigured ? "Sign in with Google" : "Set up in 5 minutes"}
          </button>
        </div>
      ) : null}

      {authOutcome === "access_denied" ? (
        <div className="card banner error" style={{ marginBottom: 16 }}>
          <div className="body">
            <h3>Google blocked the sign-in: you are not a test user</h3>
            <p>
              The consent screen is in <b>Testing</b>, so only accounts on its test-user list may
              connect — and that list belongs to the project that owns your OAuth client, not to
              any other project you have configured.
            </p>
            <p>
              {status?.projectNumber ? (
                <>
                  Add your Google account under <b>Audience &rsaquo; Test users</b> in project{" "}
                  <code>{status.projectNumber}</code>:{" "}
                  <a
                    href={
                      "https://console.cloud.google.com/auth/audience?project=" +
                      status.projectNumber
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    open Audience for that project
                  </a>
                  .
                </>
              ) : (
                <>
                  Add your Google account under <b>Audience &rsaquo; Test users</b> on the consent
                  screen of the project that owns your OAuth client.
                </>
              )}{" "}
              Testing mode also expires refresh tokens after 7 days; publishing the app removes
              both limits.
            </p>
          </div>
          <a className="btn primary" href="/api/auth/login">
            Try again
          </a>
        </div>
      ) : null}

      {authOutcome === "missing_scope" ? (
        <div className="card banner error" style={{ marginBottom: 16 }}>
          <div className="body">
            <h3>Google did not grant Analytics access</h3>
            <p>
              Sign-in worked, but the token came back without the{" "}
              <code>analytics.readonly</code> scope, so no Analytics data can be read. Google
              drops scopes that are not registered on the consent screen{" "}
              <b>of the project that owns your OAuth client</b>.
            </p>
            <p>
              {status?.projectNumber ? (
                <>
                  That project is number <code>{status.projectNumber}</code> — this link opens
                  exactly it, so you cannot land on the wrong one:{" "}
                  <a
                    href={
                      "https://console.cloud.google.com/auth/scopes?project=" +
                      status.projectNumber
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Data Access for project {status.projectNumber}
                  </a>
                  .
                </>
              ) : (
                <>
                  Open{" "}
                  <a
                    href="https://console.cloud.google.com/auth/scopes"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Auth Platform &rsaquo; Data Access
                  </a>
                  .
                </>
              )}{" "}
              Choose <b>Add or remove scopes</b>, paste{" "}
              <code>https://www.googleapis.com/auth/analytics.readonly</code> into the manual box,
              update, then <b>Save</b>. Reconnect and keep the Analytics permission ticked.
            </p>
          </div>
          <a className="btn primary" href="/api/auth/login">
            Try again
          </a>
        </div>
      ) : null}

      {error ? (
        <div className="card banner error" style={{ marginBottom: 16 }}>
          <div className="body">
            <h3>Could not load data</h3>
            <p>{error}</p>
          </div>
          <button className="btn" onClick={() => void retryAll()}>
            Retry
          </button>
        </div>
      ) : null}

      {ready && properties.length === 0 && !error ? (
        <div className="card empty">
          No GA4 properties found for this account. Check that the signed-in Google account has at
          least Viewer access to a Google Analytics 4 property.
        </div>
      ) : null}

      {ready && properties.length > 0 ? (
        <>
          <section className="section">
            <div className="section-head">
              <h2>Live now</h2>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                viewers active in the last 30 minutes
              </span>
              <span className="spacer" />
              <div className="seg" role="group" aria-label="Live view">
                <button aria-pressed={mapView === "map"} onClick={() => setMapView("map")}>
                  Map
                </button>
                <button aria-pressed={mapView === "table"} onClick={() => setMapView("table")}>
                  Table
                </button>
              </div>
            </div>

            <div className="live-grid">
              <div className={busy.realtime && !realtime ? "stale" : ""}>
                {mapView === "map" ? (
                  <WorldMap
                    points={points}
                    properties={properties}
                    hidden={hidden}
                    loading={busy.realtime && !realtime}
                  />
                ) : (
                  <LocationTable points={points} properties={properties} hidden={hidden} />
                )}
              </div>
              <LivePanel
                properties={properties}
                realtime={realtime}
                hidden={hidden}
                onToggle={toggle}
                onShowAll={() => setHidden(new Set())}
              />
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Trends</h2>
              <div className="filters" role="group" aria-label="Date range">
                <div className="seg">
                  {(status?.ranges ?? []).map((r) => (
                    <button
                      key={r.key}
                      aria-pressed={range === r.key}
                      onClick={() => setRange(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <span className="spacer" />
              <div className="seg" role="group" aria-label="Trend view">
                <button aria-pressed={trendView === "cards"} onClick={() => setTrendView("cards")}>
                  Cards
                </button>
                <button aria-pressed={trendView === "table"} onClick={() => setTrendView("table")}>
                  Table
                </button>
              </div>
            </div>

            <div className={busy.stats && !stats ? "stale" : ""}>
              <div className="tiles">
                <StatTile
                  label="Users"
                  value={compact(totals.current.activeUsers)}
                  exact={full(totals.current.activeUsers)}
                  current={totals.current.activeUsers}
                  previous={totals.previous.activeUsers}
                  comparison={comparison}
                />
                <StatTile
                  label="New users"
                  value={compact(totals.current.newUsers)}
                  exact={full(totals.current.newUsers)}
                  current={totals.current.newUsers}
                  previous={totals.previous.newUsers}
                  comparison={comparison}
                />
                <StatTile
                  label="Sessions"
                  value={compact(totals.current.sessions)}
                  exact={full(totals.current.sessions)}
                  current={totals.current.sessions}
                  previous={totals.previous.sessions}
                  comparison={comparison}
                />
                <StatTile
                  label="Page views"
                  value={compact(totals.current.screenPageViews)}
                  exact={full(totals.current.screenPageViews)}
                  current={totals.current.screenPageViews}
                  previous={totals.previous.screenPageViews}
                  comparison={comparison}
                />
                <StatTile
                  label="Engagement rate"
                  value={percent(totals.currentEngagement)}
                  current={totals.currentEngagement}
                  previous={totals.previousEngagement}
                  comparison={comparison}
                />
                <StatTile
                  label="Avg. session"
                  value={duration(totals.currentDuration)}
                  current={totals.currentDuration}
                  previous={totals.previousDuration}
                  comparison={comparison}
                />
              </div>

              <div style={{ marginTop: 12 }}>
                {trendView === "cards" ? (
                  <PropertyCards properties={properties} stats={stats} realtime={realtime} />
                ) : (
                  <TotalsTable properties={properties} stats={stats} />
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <TopTables properties={properties} stats={stats} />
              </div>
            </div>
          </section>
        </>
      ) : null}
      <footer className="app-foot">
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        {status?.signedIn && !status.mock ? (
          <>
            {/* Subject access and erasure have to be reachable by the person
                they concern, not just by an API call. */}
            <a href="/api/account/export" download>
              Export my data
            </a>
            <button type="button" className="linklike" onClick={() => void removeAccount()}>
              Delete account
            </button>
          </>
        ) : null}
      </footer>
    </div>
  );
}

/** Poll while the tab is visible; refresh immediately when it becomes visible. */
function usePoll(fn: () => void | Promise<void>, ms: number, enabled: boolean) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void saved.current();
    };

    tick();
    timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);

    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}
