# GitHub App – Zero Nonsense Licenser (Paid Plans)

Minimal GitHub App that handles **GitHub Marketplace billing** and
exposes a `/license` endpoint Actions can call to unlock Pro features.

## What it does

- Receives **Marketplace webhooks** (`marketplace_purchase.purchased`,
  `.changed`, `.cancelled`, `.pending_change`,
  `.pending_change_cancelled`) at `POST /api/webhook`, verifying
  `X-Hub-Signature-256` against `WEBHOOK_SECRET`.
- Keeps an account → plan record persisted by `JsonFileStore`
  (`src/store.ts`) at `data/licenses.json` — single-node, not durable
  across container revision restarts. **Replace with a managed DB
  before any paid customer.**
- Periodically **reconciles** state against GitHub's authoritative
  `GET /marketplace_listing/plans/{plan_id}/accounts` endpoint, every
  `RECONCILE_INTERVAL_MS` (default 6h). Set `MARKETPLACE_PLAN_IDS` to
  the comma-separated plan IDs from your Marketplace listing to
  enable.
- Exposes `GET /license?owner=<login>&repo=<repo>` with
  `Authorization: Bearer <GITHUB_TOKEN>` for Actions to call. Two
  server-side checks: (1) the caller's `GITHUB_TOKEN` is verified to
  have read access to the named repo, (2) the App JWT independently
  resolves the installation account — no client-supplied
  `account_id`/`installation_id` is trusted. Returns:
  ```json
  {
    "ok": true,
    "plan": "free|pro|org|enterprise",
    "pendingCancel": false,
    "onFreeTrial": false,
    "freeTrialEndsOn": null,
    "upgradeUrl": "https://github.com/marketplace/zero-nonsense-licenser/upgrade/<installation_id>/",
    "account": "<account login>"
  }
  ```
- Exposes `GET /setup?installation_id=<id>` — required by GitHub for
  paid Marketplace listings; renders a small HTML confirmation page
  after install/upgrade.

## Architecture

| Component | Technology |
|---|---|
| HTTP server | Express + `@octokit/app` + `@octokit/webhooks` |
| Container | `node:22-alpine`, non-root user, `dist/index.js` on port 3000 |
| Hosting | **Azure Container Apps** (consumption tier, scales to zero) |
| Image registry | Azure Container Registry (Basic), pulled via managed identity |
| Secrets | Azure Key Vault, mounted as Container App secrets via managed identity |
| Logs | Log Analytics workspace (30-day retention by default) |
| IaC | Bicep (`infra/main.bicep`), orchestrated by `azd` |

The README previously listed "Azure App Service, Fly.io, etc." as
candidate hosts; that was aspirational. The actual `azure.yaml` and
`infra/main.bicep` ship a Container Apps deployment, and the runbook
follows that.

## Setup

For the full step-by-step (provision infra, set up DNS for
`billing.zerononsense.dev`, create the GitHub App from manifest, push
secrets to Key Vault, smoke-test `/license`, apply for Verified
Publisher) see:

`../03_admin/runbook_publisher_dns_billing_smoke.md`

Quick summary:

1. **Provision infra** with `azd up` (Bicep deploys ACR + Key Vault +
   Log Analytics + Container Apps env + Container App + managed
   identity).
2. **Create the GitHub App** from `docs/manifest.yaml` — manifest URLs
   reference `billing.zerononsense.dev`, so DNS must resolve before
   this step.
3. **Push secrets** into Key Vault: `APP-ID`, `PRIVATE-KEY` (PEM),
   `CLIENT-ID`, `CLIENT-SECRET`, `WEBHOOK-SECRET`. The Bicep installs
   them as `PLACEHOLDER` values; overwrite via
   `az keyvault secret set`.
4. **Restart the Container App revision** so the secrets are read.
5. **Smoke test** `/license` from a real workflow with a `Bearer
   ${{ secrets.GITHUB_TOKEN }}`.

## Required env vars

Hard requirements (server fails fast if missing — see `src/index.ts`
lines 19–24):

| Var | Source |
|---|---|
| `APP_ID` | GitHub App settings page after manifest creation |
| `PRIVATE_KEY` | Generated and downloaded as a `.pem` from the same page |
| `CLIENT_ID` | Same page |
| `CLIENT_SECRET` | Generated on that page |
| `WEBHOOK_SECRET` | Generate locally; set the same value in App settings |

Optional:

| Var | Default | Purpose |
|---|---|---|
| `APP_SLUG` | `zero-nonsense-licenser` | Used to build `upgradeUrl` |
| `PORT` | `3000` | Bound by Container App ingress |
| `LICENSE_DB_PATH` | `../data/licenses.json` | Path for `JsonFileStore` |
| `MARKETPLACE_PLAN_IDS` | _(unset)_ | Comma-separated IDs to enable reconciliation |
| `RECONCILE_INTERVAL_MS` | `21600000` | 6 hours |

## Action shim

`action.yml` + `dist/action.cjs` expose a Node20 GitHub Action wrapper
around the same billing logic. This is a **secondary** surface; the
primary product is the HTTP server. Inputs: `github-token`,
`openai-api-key` (optional), `billing-api-url` (default
`https://billing.zerononsense.dev`), `fail-open` (default `true`).

## Production caveats

- **`JsonFileStore` is not durable.** A new Container App revision
  starts with an empty file. Either move to managed Postgres / Cosmos /
  Table Storage, or rely entirely on the reconciliation loop +
  `MARKETPLACE_PLAN_IDS` to repopulate state on boot.
- **Single replica.** `infra/main.bicep` pins `maxReplicas: 1` to
  avoid duplicate webhook processing under the file store. Don't raise
  this without first replacing the store.
- **Add auth + rate limiting** before exposing more endpoints.
- **Monitor webhook delivery health** in the GitHub App's "Advanced →
  Recent Deliveries" tab — GitHub redelivers failed events, but
  silent webhook signature mismatches will only show up there.

## License

MIT (see `LICENSE`).
