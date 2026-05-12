# Marketplace Listing — Zero Nonsense Licenser (GitHub App)

This file is the canonical copy for the Marketplace listing of the
**Zero Nonsense Licenser** GitHub App. The same content lives in two
places on github.com:

1. The App's *Basic Information → Description* field
   (`https://github.com/organizations/zero-nonsense-dev/settings/apps/zero-nonsense-licenser`).
   Markdown is supported; this is what users see when they look at the
   App's public page (`/apps/zero-nonsense-licenser`) and in the
   install flow.
2. The Marketplace listing description, once the listing is drafted
   (separate flow under the App's *Advanced* tab → *List on
   Marketplace*).

Keep them in sync by editing this file first and pasting from here.

---

## Short tagline (≤ 80 chars, for listing card / search results)

> Marketplace billing for the Zero-Nonsense Dev Action suite.

## Elevator pitch (1–2 sentences, for listing intro)

> The Zero Nonsense Licenser unlocks paid tiers across the Zero-Nonsense
> Dev Action suite — SentinelPR, ReleaseScribe, and forthcoming
> Actions — without ever reading your source code. Install once at the
> org level and your Actions resolve their plan automatically at
> runtime.

## Description (markdown, for App settings field + Marketplace listing body)

```markdown
**Zero Nonsense Licenser** is the GitHub Marketplace billing companion
for the Zero-Nonsense Dev Action suite — including
[SentinelPR](https://github.com/zero-nonsense-dev/sentinelpr-action),
[ReleaseScribe](https://github.com/zero-nonsense-dev/releasescribe-action),
and forthcoming Actions like ZN-SecAgent.

Install once on your organization (or on individual repositories). At
runtime, each Action calls `/license` with your workflow's
`GITHUB_TOKEN` and resolves your plan — `free`, `pro`, or `org` — in
under 100&nbsp;ms.

### What this App does

- Receives **GitHub Marketplace** purchase, change, and cancellation
  events for the Zero-Nonsense Dev paid plans.
- Serves a Bearer-authenticated `/license` endpoint that the
  Zero-Nonsense Dev Actions call to resolve plan entitlement on every
  workflow run.
- Periodically reconciles state against GitHub's authoritative
  subscriber list (`/marketplace_listing/plans/{plan_id}/accounts`)
  every 6 hours.

### What this App does NOT do

- **No source code, PR diffs, issues, or secrets ever reach this App.**
  Permissions are `metadata: read` and `contents: read` only — the
  Actions, not this App, are what actually review code.
- **No data shared across organizations.** Your plan record is keyed
  by your installation; nothing is cross-referenced.
- **No runner consumption.** This App runs on its own infrastructure;
  it doesn't charge your Actions minutes.

### Trust and hosting

- Hosted in **EU (West Europe)** on Azure Container Apps with managed
  certificates.
- All secrets in Azure Key Vault, fetched via managed identity — never
  in source.
- TLS everywhere, webhook signatures verified against
  `X-Hub-Signature-256` before any handler runs.
- Two independent server-side verifications on every `/license` call:
  (1) your `GITHUB_TOKEN` is verified to have read access to the named
  repo, (2) the App JWT independently resolves the installation
  account — no client-supplied identifiers are trusted.
- [Privacy Policy](https://billing.zerononsense.dev/privacy) ·
  [Terms of Service](https://billing.zerononsense.dev/terms)

### Plans

- **Community (free)** — Available now. Resolves `free` plan
  entitlement for all Actions in the Zero-Nonsense Dev suite.
- **Pro** *(coming soon)* — Per-repo monthly billing; unlocks Pro
  features like advanced policies, SARIF export, and inline fix hints
  in the Actions that support them.
- **Org** *(coming soon)* — Per-organization monthly billing;
  unlimited repos, org-wide configuration.

> **You only need this App if you're using a Zero-Nonsense Dev Action.**
> Installing it without one of our Actions is harmless but does
> nothing useful.

Source: [`zero-nonsense-dev/billing-app`](https://github.com/zero-nonsense-dev/billing-app)
```

## Listing form values (confirmed 2026-04-28)

Filled in during the draft creation flow at `/marketplace/new` →
**Create draft listing** for the Zero Nonsense Licenser GitHub App.

### Naming + classification

- **Listing name:** `Zero Nonsense Licenser`
- **Primary category:** `Utilities`
- **Secondary category:** `Code review`
- **Supported languages (6/10):** JavaScript, TypeScript, Python, Go,
  Java, C#. (Matches `ai-code-reviewer/action.yml` `include-patterns`.)

### Links

- **Customer support URL** *(required)*: `https://github.com/zero-nonsense-dev/billing-app/issues` — repo is public, accepts issues from anyone with a GitHub account.
- **Company URL:** `https://zerononsense.dev`
- **Status URL:** *(blank — no status page yet)*
- **Documentation URL:** `https://github.com/zero-nonsense-dev/billing-app#readme`

### Email aliases that the listing depends on

- `support@zerononsense.dev` — confirmed delivers to a real inbox
  (Wilco, 2026-04-28). GitHub will email this address during listing
  review and Verified Publisher review.

### Security and compliance section

Filled in at `Marketplace listing → Security and compliance`,
2026-04-28.

- **EU trader status:** "I do not operate as a trader under EU
  regulations" (org not a registered EU trader yet — revisit when
  legal entity is in place).
- **Privacy Policy URL:** `https://billing.zerononsense.dev/privacy`
- **Terms of Service URL:** `https://billing.zerononsense.dev/terms`
- **Repository visibility:** Public.
- **Public repository URL:** `https://github.com/zero-nonsense-dev/billing-app`

#### Third-party services required (verbatim form value)

> Microsoft Azure (hosting infrastructure — Container Apps, Container
> Registry, Key Vault, Log Analytics; West Europe region). GitHub API
> via Octokit (installation lookups, plan reconciliation).

#### Transparency disclosures (verbatim form value)

```markdown
### Security measures

- **Authentication on every endpoint.** `/license` requires
  `Authorization: Bearer <GITHUB_TOKEN>` and verifies the caller's
  token against the named repository before responding. `/api/webhook`
  verifies `X-Hub-Signature-256` against the webhook secret before
  any handler runs. Outbound calls to GitHub are signed with a
  short-lived RS256 JWT generated from the App's private key.
- **Two independent verifications on every `/license` call:** (1)
  the caller's GITHUB_TOKEN must have read access to the named repo
  (verified via Octokit), and (2) the App JWT independently resolves
  the installation account from GitHub's API. No client-supplied
  account or installation identifier is ever trusted.
- **Access controls:** the container runs as a non-root user.
  Secrets are pulled from Azure Key Vault via managed identity — no
  secret values are stored in the container image, environment
  variables at rest, or source code. Container Registry pulls use
  the same managed identity (admin user disabled).
- **Incident response:** all container traffic is logged to Azure
  Log Analytics (30-day retention). Webhook delivery health is
  observable in the GitHub App's "Recent Deliveries" tab. The App
  is single-replica (`maxReplicas: 1`) to prevent duplicate webhook
  processing.

### Data handling

- **What is stored:** GitHub account ID and login, plan name
  (`free`/`pro`/`org`), billing dates (effective date, free-trial
  end), pending-cancellation flag, unit count.
- **What is never stored:** source code, pull-request diffs, issues,
  comments, secrets, or any other repository content. Permissions
  requested by the App are limited to `metadata: read` and
  `contents: read`.
- **Retention:** entitlement records persist while the App is
  installed. On uninstall, GitHub stops sending webhooks; the
  reconciliation loop ages the record out on its next pass (every
  6 hours).
- **Residency:** all data resides in Azure West Europe.

### Compliance

- **GDPR:** EU residency; the only personal data held is the GitHub
  account login + numeric ID, both already public on github.com.
- **SOC 2 / ISO 27001:** none claimed at v1.
- **Source code:** publicly available at
  `https://github.com/zero-nonsense-dev/billing-app` for independent
  audit.

### EU AI Act

Not applicable. The Zero Nonsense Licenser performs no AI inference,
no machine-learning model execution, and no LLM calls. It is a
deterministic entitlement and billing service. (The Actions whose
paid tiers this App unlocks may use AI; those have their own
Marketplace listings with their own AI Act disclosures.)

### Third-party services

- **Microsoft Azure** — hosting infrastructure (Container Apps,
  Container Registry, Key Vault, Log Analytics), West Europe region.
- **GitHub** — Marketplace purchase webhooks (inbound) and
  installation / repo metadata lookups via Octokit (outbound).

No other third parties receive or process customer data.
```

## Permissions consumed (read-only summary, for the "Permissions"
section of the listing)

Per `docs/manifest.yaml`, the App requests:

- **Repository permissions:**
  - `metadata: read` — required by GitHub for any installed App.
  - `contents: read` — used only to verify the caller's token has
    read access to the repo before resolving its plan.
- **Subscribed events:**
  - `marketplace_purchase` — billing
  - `installation` — track installations
  - `installation_repositories` — track which repos the App is
    installed on

No `issues`, `pull-requests`, `actions`, or `secrets` permissions are
requested. The App cannot read or modify code under any circumstance.

## Plans and pricing section (filled 2026-04-28)

### Community (Free) — published in draft

- **Plan name:** `Community (Free)`
- **Pricing model:** `Free`
- **Available for:** `Personal accounts and organizations`
- **Short description (verbatim):**
  > Free entitlement layer for the Zero-Nonsense Dev Action suite.
  > Resolves the free tier of SentinelPR, ReleaseScribe, and future
  > suite Actions at workflow runtime.
- **Plan bullets:**
  1. `Unlocks the free tier of every Zero-Nonsense Dev Action`
  2. `Sub-100ms /license resolution from your workflows`
  3. `Read-only permissions; never sees your source code`
  4. `EU-hosted (Azure West Europe); webhook signatures verified`

### Webhook section (filled 2026-04-28)

This is the **Marketplace-listing webhook**, distinct from the App's
own webhook (which lives at `App settings → Webhook`). Both channels
deliver `marketplace_purchase.*` events. We point the listing webhook
at the same URL and verify with the same secret so the existing
idempotent handlers in `src/index.ts` cover both delivery paths.

- **Payload URL:** `https://billing.zerononsense.dev/api/webhook`
- **Content type:** `application/json`
  (default is `x-www-form-urlencoded`; we override because our
  Express middleware parses JSON)
- **Secret:** same value as the `WEBHOOK-SECRET` secret in Key Vault
  `kv-billingappprod`. Retrieve with
  `az keyvault secret show --vault-name kv-billingappprod --name WEBHOOK-SECRET --query value -o tsv`.
- **Active:** ✓

## Pro / Org plans (deferred until Verified Publisher is approved)

GitHub Marketplace requires every plan to offer **monthly and annual**
pricing. Suggested initial pricing (refine before submission):

| Plan | Monthly | Annual | Per | Notes |
|---|---|---|---|---|
| Community | $0 | $0 | — | Available now |
| Pro | $19 | $190 | repo | Unlocks Pro features in any installed Action |
| Org | $99 | $990 | org | Unlimited repos, org-wide config |

(Enterprise — custom — handled outside Marketplace.)

The plan IDs that GitHub assigns must be saved into the
`MARKETPLACE_PLAN_IDS` Key Vault secret so the reconciliation loop
in `src/index.ts` can pull authoritative state.

## Listing checklist

Before submitting:

- [ ] Description filled in App settings *(use the markdown block
      above)*
- [ ] Logo uploaded *(already done — see screenshot 27 Apr 2026)*
- [ ] Homepage URL = `https://billing.zerononsense.dev` *(done)*
- [ ] Privacy URL = `https://billing.zerononsense.dev/privacy` *(done)*
- [ ] Terms URL = `https://billing.zerononsense.dev/terms` *(done)*
- [ ] Support contact set (`support@zerononsense.dev` or similar)
- [ ] Categories + tags chosen
- [ ] Free plan defined (Community, $0/$0)
- [ ] Paid plans defined (only after Verified Publisher status is
      approved — leave the listing in draft until then)
- [ ] Listing saved as draft

Submit for review only after all of the above and after Verified
Publisher status is **Approved**.
