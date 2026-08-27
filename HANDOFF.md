# Handoff - state as of 26 Aug 2026

Working notes for picking this back up. The README is the durable documentation;
this file is "where we got to and what is next".

---

## Where it stands

**The app works end to end against a real Google account.** Six properties load,
live viewers appear on the map, trends render, and the API-call rate is under
control. It is multi-user and ready to deploy - what remains is infrastructure and
Google's review, not application code.

### Done and verified

| Area | State |
|---|---|
| Dashboard (map, trends, tables, table-view twins) | Working against live data |
| Multi-user: sessions, per-user tokens, per-user cache keys | 20 storage/crypto checks pass |
| Refresh tokens encrypted at rest (AES-256-GCM) | Verified absent from the DB file, WAL included |
| Per-property refresh scheduler | 13 checks pass; 7 API calls vs 12 measured live |
| OAuth CSRF (`state` in a cookie) | Forged and missing-state callbacks rejected |
| Security headers, rate limiting, `trust proxy`, `/healthz` | Verified on the wire (429 at request 31) |
| Public pages at `/about`, `/privacy`, `/terms` | Served with no session; API still 401s |
| Data export + account deletion, reachable in the UI | Verified, no credential leakage |

### Written but NOT verified

- **`Dockerfile`** - never built. Docker Desktop was installed but its Linux
  engine would not start; a reboot was needed. **First thing to do: build it.**
- **SIGTERM graceful shutdown** - the handler is registered and correct for
  Linux, but Windows has no real SIGTERM so it could not be exercised here.
  Verify it in the container.

```bash
docker build -t flotilla:test .
docker run --rm -p 8080:10000 -e ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" flotilla:test
# then: curl localhost:8080/healthz  and  docker stop <id> - expect a clean drain in the logs
```

---

## Google Cloud - current setup

| Thing | Value |
|---|---|
| Project | The Cloud project ID is unchanged by the product rename. The project number is the prefix of `GOOGLE_CLIENT_ID` in your local `.env` - deliberately not recorded here, since this repository is public. |
| Publishing status | **Testing** |
| Scope | `analytics.readonly` (added under Data Access) |
| APIs enabled | Analytics **Data** API and Analytics **Admin** API - both required |
| Test user | The owner's Google account |
| Redirect URI (dev) | `http://localhost:5175/api/auth/callback` |
| Redirect URI (prod, to add) | `https://flotillahq.com/api/auth/callback` |

Credentials are in `.env` (gitignored). The dev server watches that file and picks
up changes on save - no restart needed.

> An older project was abandoned because its consent screen carried the Gmail
> **restricted** scope `https://mail.google.com/`. Restricted scopes drag in an
> annual third-party security assessment (CASA). Keep this project to
> `analytics.readonly` only.

**While in Testing, refresh tokens expire after 7 days.** If the dashboard asks to
reconnect roughly weekly, that is why - publishing the app removes it.

---

## What is left, in order

1. **Reboot, then verify Docker** - the build and SIGTERM, per the commands above.
2. ~~Buy a domain.~~ Done: **flotillahq.com**.
3. **Deploy to Render** from `render.yaml`. Needs a **paid** instance: the free
   tier has no persistent disk, and without a disk at `/app/data` every redeploy
   destroys the database *and* the encryption key.
   Secrets to set in the dashboard: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `ENCRYPTION_KEY`, `OAUTH_REDIRECT_URI`.
4. **Point the domain at Render**, then add
   `https://<domain>/api/auth/callback` to the OAuth client's redirect URIs and
   set `OAUTH_REDIRECT_URI` to match exactly.
5. **Fill in the site placeholders.** This must return nothing:
   ```bash
   grep -rn "you@example.com\|Your Company\|\[EFFECTIVE DATE\]\|\[JURISDICTION\]" site/
   ```
6. **Verify the domain in Search Console** - with the *same* Google account that
   owns the Cloud project.
7. **Point the consent screen** at `/about`, `/privacy`, `/terms`. Use `/about`,
   not `/`, as the home page: the root is the dashboard, and a reviewer landing on
   a sign-in prompt counts as a login wall.
8. **Record the demo video.** Unlisted on YouTube, in English, showing the consent
   flow, the app name, **the browser address bar with the OAuth client ID visible**
   (do not crop it), and the app working. Record against the real domain.
9. **Submit for verification** - Google documents 3-5 business days for sensitive
   scopes. No security assessment is required at this tier.
10. **Publish the app to production**, which ends the 7-day token expiry.

The full checklist, including the GDPR items, is in `site/README.md`.

---

## Known trade-offs

- **One instance only.** SQLite has a single writer. Sessions and the OAuth state
  cookie are already replica-safe; the database is not. Scaling out means writing
  a Postgres adapter against `server/src/storage/types.ts` - one class, no caller
  changes.
- **`ENCRYPTION_KEY` is unrecoverable.** Lose or rotate it and every stored token
  becomes permanently undecryptable; all users must reconnect.
- **The setup panel is local-only** by design. It writes to `.env`, so it is
  loopback-only and hard-disabled when `NODE_ENV=production`.
- **Idle backoff is capped at 2 minutes**, not longer. More would save quota but
  would let a new viewer stay invisible too long on a product that says "live".

---

## Re-running the checks

```bash
npm run build                 # both workspaces, type-checked
npm run dev                   # API :5175, UI :5174
npm run dev:mock              # generated data, no Google account needed
curl localhost:5175/healthz
```

Scratch test scripts from the last session (scheduler, tenancy, live probe) live
in the session temp directory and are disposable - the behaviour they cover is
described above and in the README if it needs re-testing.
