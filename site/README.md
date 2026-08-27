# Public site

Three static pages. They exist because **Google OAuth verification requires them**
before `analytics.readonly` can be used by anyone outside your test-user list.

```
index.html    Homepage - what the app does and which scopes it uses
privacy.html  Privacy policy, including the Limited Use disclosure
terms.html    Terms of service
style.css     Shared styling, matching the app
```

## Placeholders (filled 26 Aug 2026)

These were the placeholders. They are now filled in, with the values below. The
table is kept so the substitutions are documented rather than mysterious:

| Placeholder | Now reads |
|---|---|
| `flotillahq.com` | The domain you will verify with Google |
| `you@example.com` | hello@lotsmith.co |
| `Your Company` | Vincent Vitale (sole trader) |
| `[EFFECTIVE DATE]` | 26 August 2026 |
| `[JURISDICTION]` | the State of California, United States |

```bash
grep -rn "flotillahq.com\|you@example.com\|Your Company\|\[EFFECTIVE DATE\]\|\[JURISDICTION\]" site/
```

That grep must keep returning nothing. It only scans the pages, not this file.

**These are not legal advice.** The privacy policy is an accurate description of
what the application genuinely does - worth more to a reviewer than a generic
template - but have it reviewed before you rely on it.

## How these are served

The application serves them itself, so there is one domain and one deployment:

| URL | File |
|---|---|
| `/about` | `index.html` |
| `/privacy` | `privacy.html` |
| `/terms` | `terms.html` |

`.html` suffixes also work. They are served with **no session check** - Google's
reviewer opens them signed out, and a login wall fails the review. The dashboard
keeps `/`, and links to all three from its footer.

## Google verification checklist

Your OAuth consent screen (Branding) must point at these:

- [ ] **Application home page** - `https://flotillahq.com/about`
- [ ] **Privacy policy link** - `https://flotillahq.com/privacy`
- [ ] **Terms of service link** - `https://flotillahq.com/terms`
- [ ] **Authorised domain** - `flotillahq.com`, verified in
      [Search Console](https://search.google.com/search-console) with the *same*
      Google account that owns the Cloud project
- [ ] App name and logo consistent with the site
- [ ] The homepage must be reachable publicly, with no login wall, and must
      visibly describe the app and link to the privacy policy - `/about` is
      used rather than `/` because the root is the dashboard, and a reviewer
      landing on a sign-in prompt counts as a login wall

Then, in the Verification Center, you will also be asked for:

- [ ] **Scope justification** for `analytics.readonly` - say plainly that the
      product's entire function is displaying the user's own Analytics data, that
      the scope is read-only, and that no narrower scope exists.
- [ ] **A demo video**, uploaded to YouTube as **Unlisted**, recorded in English.
      Google is specific about this one, and it is the usual reason for a
      rejection:
      - the OAuth grant flow exactly as a user experiences it
      - the consent screen showing **your app name**
      - **the browser address bar visible, showing your OAuth client ID** - do
        not crop the URL bar out of the recording
      - what each sensitive scope actually enables, demonstrated in the app
      - recorded against the production domain, not localhost
- [ ] Confirmation that you comply with the Limited Use requirements - the
      disclosure is already in `privacy.html`.

Google documents sensitive-scope review as **3-5 business days**. A follow-up
question resets that clock, so getting the video and the justification right
first time matters more than submitting early.

No third-party security assessment is required for a sensitive scope. That
obligation (the CASA assessment) applies to *restricted* scopes such as Gmail or
Drive - which is why keeping this app in its own Cloud project, with only
`analytics.readonly`, matters.

---

## Beyond Google: data protection law

Google's approval is not legal compliance. If you have users in the EU or UK,
GDPR applies from your first user. None of this is legal advice.

**Already handled by the app:**

- Privacy notice, with lawful basis stated (performance of a contract)
- Right to erasure - *Delete account* in the app footer removes the account,
  tokens, sessions and settings, and revokes access at Google
- Right of access and portability - *Export my data* downloads everything held
  about the user as JSON, with live credentials deliberately excluded
- Right to withdraw consent - the Disconnect button
- Data minimisation - report data is never written to disk
- Security of processing - tokens encrypted at rest, HTTPS, hardened cookies
- **No cookie banner needed.** The only cookie is a strictly-necessary session
  cookie, and the app runs no analytics or advertising trackers on itself, so
  ePrivacy consent does not apply. Do not add one unless that changes.

**Still to do, mostly paperwork:**

- [ ] **Sub-processor agreements.** Accept the Data Processing Addendum from
      your host, and from Google. Keep a list of sub-processors.
- [ ] **International transfers.** If you host outside the EEA and have EU
      users, rely on your host's Standard Contractual Clauses.
- [ ] **Breach procedure.** GDPR gives you 72 hours to notify. Write down who
      does what before you need it.
- [ ] **Record of processing** (Article 30). One page is enough at this size.
- [ ] **If you sell to companies**, expect them to ask for a DPA naming you as
      *processor* of their Analytics data. Have one ready.

**Probably not yet:** CCPA/CPRA binds businesses over roughly $25M revenue or
100k California consumers. Worth revisiting, not worth blocking launch on.

**If you charge money:** distance-selling and refund rules, and EU VAT on
digital services from the first euro. A merchant of record (Paddle, Lemon
Squeezy) absorbs most of that; Stripe alone does not.
