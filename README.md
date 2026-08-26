# Flotilla

Every Google Analytics property you can see, on one screen. Live viewers plotted on
a world map — each property in its own colour and marker shape — with the stats
underneath.

- **Live map** — viewers active in the last 30 minutes, positioned by city, sized by
  how many are there, coloured and shaped per property. Pan, zoom, hover for a
  breakdown, click a property in the legend to hide it.
- **Trends below** — users, new users, sessions, page views, engagement rate and
  average session for today / 7 / 28 / 90 days, each against the previous period,
  plus a per-property card with a sparkline, and top pages and channels across
  every property.
- **No per-property setup** — sign in once and it discovers every GA4 property your
  Google account can read, across all your Analytics accounts.

---

## Try it without a Google account

```bash
npm install
npm run dev:mock
```

Open <http://localhost:5174>. Mock mode generates six fake properties with realistic
traffic and never contacts Google — useful for looking around, and for working on
the UI.

---

## Connecting your real Analytics account

**The app walks you through this.** Start it (`npm run dev` or `npm run dev:mock`)
and click **Connect Google Analytics** in the header. The panel lists each step,
gives you the exact redirect URI to copy, and takes the client ID and secret at the
end — writing them to `.env` for you. No file editing required.

The same steps are written out below if you would rather do it by hand.

You need a Google OAuth client because that is the only way Google will hand over
Analytics data. It is free and you do it once.

### 1. Create a Google Cloud project

Go to <https://console.cloud.google.com/> and create a project (or pick an existing
one). Any project works — it is only the container for the OAuth client.

### 2. Enable the two Analytics APIs

In **APIs & Services → Library**, search for and enable both:

- **Google Analytics Data API** — the traffic numbers and live viewers
- **Google Analytics Admin API** — used once, to list your properties

### 3. Configure the consent screen

**APIs & Services → OAuth consent screen**

- User type: **External** (or **Internal** if you are on Google Workspace)
- Fill in an app name and your own email for the support/developer contacts
- Add the scope `https://www.googleapis.com/auth/analytics.readonly`
- Under **Test users**, add the Google account you will sign in with

Leaving the app in "Testing" is fine. You do not need Google verification — it is
only ever you signing in.

### 4. Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Web application**
- Under **Authorised redirect URIs** add exactly:

  ```
  http://localhost:5175/api/auth/callback
  ```

  This must match `OAUTH_REDIRECT_URI` in your `.env` character for character, or
  Google returns `redirect_uri_mismatch`.

Copy the client ID and client secret.

### 5. Hand over the client ID and secret

Easiest: paste both into the **Connect Google Analytics** panel in the app and hit
**Save and continue** — it writes `.env` and applies them without a restart.

By hand instead:

```bash
cp .env.example .env
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart. Everything else
has a working default.

### 6. Run it

```bash
npm run dev
```

Open <http://localhost:5174>, click **Connect Google Analytics**, and approve. Your
account and its encrypted refresh token are stored in the local SQLite database at
`data/flotilla.db`, so you sign in once, not once per session.

> Google shows an "unverified app" warning because the app is in Testing mode.
> Choose **Advanced → Go to \<app name\> (unsafe)**. It is your own client, talking
> to your own account, running on your own machine.

---

## Contributing

This repository is public and the app handles Google credentials, so a
pre-commit hook scans staged content for secrets. Git does not enable hooks
automatically on clone — turn it on once:

```bash
git config core.hooksPath .githooks
```

It blocks environment files, keys, database files and anything shaped like a
live credential. Documentation placeholders are deliberately not matched.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API on :5175, UI on :5174 with hot reload |
| `npm run dev:mock` | The same, on generated data — no Google account needed |
| `npm run build` | Type-check and build both the UI and the server |
| `npm start` | Run the built app — server and UI together on :5175 |

---

## How it works

```
web/              React + Vite dashboard. Talks only to /api.
server/           Express. Sessions, Google calls, caching, geography.
server/storage/   Persistence behind one interface — SQLite today, swappable.
site/             Public homepage, privacy policy and terms (Google requires them).
data/             SQLite database + the dev encryption key. Never commit it.
```

**It is multi-user.** Each person signs in with Google; that *is* their account.
Their refresh token is stored encrypted (AES-256-GCM) against their user row,
their colour assignments are their own, and every cache key is namespaced by user
id so one person's analytics can never be served to another.

Swapping SQLite for Postgres means writing one more class against
`server/src/storage/types.ts` and returning it from `createStorage()`. No caller
changes.

The server exposes a small API:

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Session state: signed in, connected, mock |
| `GET /api/auth/login` | Starts the Google consent flow |
| `GET /api/auth/callback` | Completes it, creates the user and session |
| `POST /api/auth/logout` | Ends the browser session |
| `POST /api/auth/disconnect` | Revokes Google access, keeps the account |
| `POST /api/account/delete` | Erases the account and every stored token |
| `GET /api/properties` | Every GA4 property this user can read |
| `GET /api/realtime` | Live viewers, per property, with map coordinates |
| `GET /api/stats?range=` | Totals, daily series, top pages and channels |

Every data route requires a session and returns `401` without one.

**Where the map dots come from.** The GA4 realtime API reports a country and city
name, not coordinates. The server resolves those against the GeoNames dataset
(`all-the-cities`) — exact match first, then a small alias table for the places
Google and GeoNames name differently (Kyiv/Kiev, Bengaluru/Bangalore,
Munich/München), then a prefix match that catches "New York" → "New York City".
When only the country is known, the dot goes to that country's population-weighted
centre and the table marks it "(approx.)".

**Caching and quota.** Concurrent requests for the same thing are de-duplicated,
so ten open tabs cost one call to Google. The browser polls every 20 seconds and
stops entirely while the tab is in the background. If one property fails (revoked
access, an API not enabled) it is marked on its own card, keeps its last good
figures on the map, and the others carry on.

Refresh rate is decided **per property**, not globally — see
`server/src/scheduler.ts`:

| Situation | Behaviour |
|---|---|
| Live viewers present | Full speed (15s base, configurable) |
| No live viewers | Backs off 15s → 30s → 1m → 2m, capped there |
| Property is failing | 30s → 1m → 2m → 5m → 15m |
| Google reports low quota | Overrides both: 10× at 15% tokens left, 40× at 5% |
| Idle property | Skips the second API call entirely |

That last one is free: `activeUsers` covers the last 30 minutes, so if it is zero
then every minute of the pulse sparkline is zero too — there is nothing to fetch.

Measured against a real account with six properties, one of them busy: **7 API
calls where the naive version made 12**, and repeat requests inside the interval
make none at all. Over an hour with a tab open that is 645 calls instead of 2,160.

A property that gains a viewer returns to full speed on the very next poll — the
back-off never delays *noticing* traffic by more than one interval.

---

## Why colour *and* shape

Each property gets a colour, but colour alone caps out sooner than you would
expect. A map is an "all-pairs" chart: any two markers can end up beside each other,
so every pair has to stay distinguishable — including under colour-vision
deficiency. Running the eight-hue reference palette through a validator, only
**four** clear that bar together as a set.

So identity here is colour **×** shape: four hues cycling against circle, square,
triangle and diamond. Sixteen properties stay individually identifiable, no hue is
ever invented or reused ambiguously, and the legend shows the exact mark used on
the map rather than asking you to match colours by eye. Both views also have a
plain-text table twin, so nothing is readable only by colour.

Colours are assigned on first sight and stored in `data/assignments.json`, so a
property keeps its identity — adding or removing one never repaints the others. To
reshuffle, delete that file.

---

## Deploying

The server serves the built UI, so production is a single origin on one port.

**Render (or any host that runs a container with a persistent disk).**
`render.yaml` is a ready blueprint: Docker runtime, `/healthz` health check, and
a 1 GB disk mounted at `/app/data`. Create the service from it, then set the four
secret variables in the dashboard — they are deliberately not in git.

**Vercel will not work.** It has no persistent filesystem, so the SQLite database
and the encryption key are destroyed on every deploy and cold start, and the
server is a long-lived process rather than a set of functions.

**One domain covers everything.** The app also serves the public pages Google
verification requires — `/about`, `/privacy` and `/terms`, from `site/`, with no
session check. There is no second host to deploy or DNS record to point.

**The disk is not optional.** Without a persistent mount at `/app/data`, every
redeploy wipes the database (every user's stored Google connection) and the
encryption key. If that key is lost or regenerated, any surviving database is
permanently undecryptable.

### Production checklist

- [ ] `ENCRYPTION_KEY` set from a secret manager — **not** the generated dev key.
      Changing it later invalidates every stored token.
- [ ] `NODE_ENV=production` — this also disables the in-app setup panel, which
      writes to the server's filesystem and must never be reachable remotely.
- [ ] `HOST=0.0.0.0` in a container (the Dockerfile sets this).
- [ ] HTTPS terminated in front, with `SECURE_COOKIES=1`.
- [ ] `OAUTH_REDIRECT_URI` pointing at the public URL, and that same URL added to
      the OAuth client's authorised redirect URIs.
- [ ] A persistent disk mounted at `/app/data`, with backups.
- [ ] **One instance only.** SQLite has a single writer. Sessions and the OAuth
      state cookie are already replica-safe, but the database is not — scaling
      out means writing a Postgres adapter first.

### What is already handled

Security headers (CSP, HSTS, nosniff, frame-deny), per-IP rate limiting on
`/api/auth` and `/api`, `trust proxy` so client IPs and secure cookies work behind
a load balancer, a `/healthz` probe, and SIGTERM draining that closes SQLite
cleanly so a redeploy never leaves a dirty WAL.

### Production checklist

- [ ] `ENCRYPTION_KEY` set from a secret manager — **not** the generated dev key.
      Changing it later invalidates every stored token.
- [ ] `NODE_ENV=production` — this also disables the in-app setup panel, which
      writes to the server's filesystem and must never be reachable remotely.
- [ ] `HOST=0.0.0.0` if running behind a reverse proxy or in a container.
- [ ] HTTPS terminated in front, with `SECURE_COOKIES=1`.
- [ ] `OAUTH_REDIRECT_URI` pointing at the public URL, and that same URL added to
      the OAuth client's authorised redirect URIs.
- [ ] `data/` on a persistent volume, with backups.

### Before other people can sign in

`analytics.readonly` is a **sensitive** scope, so Google gates how widely you can
share the app:

| Publishing status | Who can connect | Catch |
|---|---|---|
| Testing | Accounts you add as test users | Refresh tokens expire after **7 days** |
| Production, unverified | Capped, small | "Google hasn't verified this app" warning |
| Production, verified | Anyone | Requires review — see below |

Verification needs a homepage and privacy policy on a domain you have verified in
Search Console, an explanation of why you need the scope, and a video of the
consent flow. Budget weeks. The app already implements the two things Google
checks for on the technical side: revoking access (`/api/auth/disconnect`) and
full account deletion (`/api/account/delete`).

**Scaling note.** The dashboard currently polls every 20s and makes two realtime
API calls per property per user. That is fine for tens of users; before hundreds,
move to shared scheduling with backoff, and only poll for users with a tab open.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | `OAUTH_REDIRECT_URI` and the URI on the OAuth client differ. They must match exactly, including port and scheme. |
| "No GA4 properties found" | The signed-in account has no GA4 property access, or the Admin API is not enabled. Universal Analytics properties are not supported by these APIs. |
| A single card shows a warning | That property alone failed — usually missing access. The others are unaffected. |
| Live map empty, stats fine | Normal when nobody is on your sites right now. Check the "live now" count in the header. |
| `403 ... has not been used in project` | Enable the Data and Admin APIs (step 2), then wait a minute. |
| Slow load, or stale/duplicate data | An older copy of the server is still holding the port. The server now refuses to start in that case and says so — stop the old process (`npx kill-port 5174 5175`, or close the old terminal) and start again. |
| Still showing generated data after connecting | `MOCK` yields automatically once you are signed in. If it persists, the sign-in did not complete — check the header for your email address. |
