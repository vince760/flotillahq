import { useState } from "react";
import { configureOAuth, type Status } from "../api";

/**
 * Everything needed to go from a fresh clone to live data, in the app itself.
 * The Google Cloud steps cannot be automated away — an OAuth client is required
 * to read the Analytics APIs — but nothing here should send anyone hunting
 * through a README for the redirect URI.
 */
export function ConnectPanel({
  status,
  onClose,
  onConfigured,
}: {
  status: Status;
  onClose: () => void;
  onConfigured: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedScope, setCopiedScope] = useState(false);

  const redirectUri = status.redirectUri;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await configureOAuth(clientId.trim(), clientSecret.trim());
      onConfigured();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function copyScope() {
    try {
      await navigator.clipboard.writeText("https://www.googleapis.com/auth/analytics.readonly");
      setCopiedScope(true);
      setTimeout(() => setCopiedScope(false), 1600);
    } catch {
      setCopiedScope(false);
    }
  }

  async function copyUri() {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  // Deployed instances take credentials from the environment only — the panel
  // writes a file on the server, which has no business being reachable remotely.
  if (!status.oauthConfigured && !status.setupUiAvailable) {
    return (
      <div className="card setup">
        <div className="setup-head">
          <h3>Not configured</h3>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="setup-lead">
          This instance has no Google OAuth client, and the in-app setup panel is disabled here
          because it writes to the server's filesystem.
        </p>
        <p className="setup-lead">
          Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the
          environment, make sure <code>OAUTH_REDIRECT_URI</code> matches this host, and restart.
        </p>
      </div>
    );
  }

  // Already configured: the only thing left is the Google consent screen.
  if (status.oauthConfigured) {
    return (
      <div className="card setup">
        <div className="setup-head">
          <h3>Connect Google Analytics</h3>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="setup-lead">
          Sign in with the Google account that can see your Analytics properties. Every GA4 property
          it can read is picked up automatically — nothing else to set up.
        </p>
        <a className="btn primary" href="/api/auth/login">
          Sign in with Google
        </a>
      </div>
    );
  }

  return (
    <div className="card setup">
      <div className="setup-head">
        <h3>Set up this instance</h3>
        <span className="tag">Administrator · one time</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="setup-callout">
        <b>Your users never see this screen.</b> This is the one-time OAuth client for the whole
        deployment. Once it is saved, everyone who visits just gets a{" "}
        <b>Sign in with Google</b> button — no Cloud Console, no API setup, nothing to configure.
      </div>

      <p className="setup-lead">
        Google requires one OAuth client per application before it will hand over Analytics data.
        It is free and takes about five minutes.
      </p>

      <ol className="steps">
        <li>
          <b>Create a project</b> at{" "}
          <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
            console.cloud.google.com
          </a>{" "}
          — or reuse any existing one.
        </li>
        <li>
          <b>Enable both APIs:</b>{" "}
          <a
            href="https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com"
            target="_blank"
            rel="noreferrer"
          >
            Analytics Data API
          </a>{" "}
          and{" "}
          <a
            href="https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com"
            target="_blank"
            rel="noreferrer"
          >
            Analytics Admin API
          </a>
          .
        </li>
        <li>
          <b>Set up the consent screen</b> (
          <a
            href="https://console.cloud.google.com/apis/credentials/consent"
            target="_blank"
            rel="noreferrer"
          >
            here
          </a>
          ): user type <b>External</b>, then add your own Google account under <b>Test users</b>.
          Leaving it in "Testing" is fine — no Google review needed.
        </li>
        <li>
          <b>Add the Analytics scope</b> under{" "}
          <a href="https://console.cloud.google.com/auth/scopes" target="_blank" rel="noreferrer">
            Data Access
          </a>{" "}
          — this step is easy to miss, and without it Google signs you in but hands back no
          Analytics access at all:
          <div className="uri-row">
            <code>https://www.googleapis.com/auth/analytics.readonly</code>
            <button type="button" className="btn" onClick={copyScope}>
              {copiedScope ? "Copied" : "Copy"}
            </button>
          </div>
        </li>
        <li>
          <b>Create the client</b> (
          <a
            href="https://console.cloud.google.com/apis/credentials/oauthclient"
            target="_blank"
            rel="noreferrer"
          >
            here
          </a>
          ): type <b>Web application</b>. Under <b>Authorised redirect URIs</b> add exactly this —
          it must match character for character:
          <div className="uri-row">
            <code>{redirectUri}</code>
            <button type="button" className="btn" onClick={copyUri}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </li>
        <li>
          <b>Paste the client ID and secret below.</b> They are written to your local{" "}
          <code>.env</code> and never leave this machine.
        </li>
      </ol>

      <form onSubmit={save} className="setup-form">
        <label>
          <span>Client ID</span>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456789-abc123.apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          <span>Client secret</span>
          <input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="GOCSPX-…"
            autoComplete="off"
            spellCheck={false}
            type="password"
          />
        </label>

        {error ? <div className="setup-error">{error}</div> : null}

        <button className="btn primary" type="submit" disabled={saving || !clientId || !clientSecret}>
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </form>

      <p className="setup-foot">
        Prefer the command line? Put the same two values in <code>.env</code> as{" "}
        <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> — <code>npm run dev</code>{" "}
        watches that file and picks them up on save.
      </p>
    </div>
  );
}
