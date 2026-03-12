
# GitHub App – Zero Nonsense Licenser (Paid Plans)

Minimal GitHub App to handle **GitHub Marketplace billing** and expose a `/license` endpoint that Actions can call to unlock Pro features.

## What it does
- Receives **Marketplace webhooks** and keeps an in‑memory map of account → plan
- Exposes `GET /license?account_id=<id>&account_type=<Organization|User>` returning `{ plan: 'free'|'pro'|'org' }`
- Source of truth for entitlements used by your Actions

## Setup
1. Create the App from **Manifest** using `docs/manifest.yaml`.
2. Enable **Marketplace** and configure **paid plans**.
3. Deploy (Azure App Service, Fly.io, etc.).
4. Set env vars: `APP_ID`, `PRIVATE_KEY`, `CLIENT_ID`, `CLIENT_SECRET`, `WEBHOOK_SECRET`.
5. Point webhook URL to your deployment.

> Replace in‑memory store with a durable DB and add auth/rate limiting for production.



