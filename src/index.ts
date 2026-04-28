import express from 'express';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { createNodeMiddleware } from '@octokit/webhooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonFileStore, type ILicenseStore, type LicenseRecord } from './store.js';

// ─── Configuration ───────────────────────────────────────────────────────────
// Required: APP_ID, PRIVATE_KEY (PEM), CLIENT_ID, CLIENT_SECRET, WEBHOOK_SECRET
// Optional:  APP_SLUG, PORT, LICENSE_DB_PATH, MARKETPLACE_PLAN_IDS, RECONCILE_INTERVAL_MS

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.env.LICENSE_DB_PATH
  ?? path.resolve(__dirname, '../data/licenses.json');

// Fail fast on missing configuration – surfaces errors at startup, not at first request
const REQUIRED_ENV = ['APP_ID', 'PRIVATE_KEY', 'CLIENT_ID', 'CLIENT_SECRET', 'WEBHOOK_SECRET'];
const missingEnv   = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error('Missing required env vars:', missingEnv.join(', '));
  process.exit(1);
}

const APP_SLUG     = process.env.APP_SLUG ?? 'zero-nonsense-licenser';
const store: ILicenseStore = new JsonFileStore(DB_PATH);

const ghApp = new App({
  appId:    process.env.APP_ID!,
  privateKey: process.env.PRIVATE_KEY!,
  oauth:    { clientId: process.env.CLIENT_ID!, clientSecret: process.env.CLIENT_SECRET! },
  webhooks: { secret: process.env.WEBHOOK_SECRET! },
});

// ghApp.octokit is authenticated with an App-level JWT via @octokit/auth-app.
// Use the generic request() API since .rest.apps.* methods are not guaranteed
// on this Octokit instance at runtime.
const appOctokit = ghApp.octokit;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function storeKey(type: string, id: number): string {
  return `${type}:${id}`;
}

function recordFromPayload(payload: any): LicenseRecord {
  const mp = payload.marketplace_purchase;
  return {
    plan:            mp.plan?.name          ?? 'free',
    accountId:       mp.account.id,
    accountType:     mp.account.type,
    accountLogin:    mp.account.login,
    onFreeTrial:     mp.on_free_trial       ?? false,
    freeTrialEndsOn: mp.free_trial_ends_on  ?? null,
    unitCount:       mp.unit_count          ?? null,
    effectiveDate:   payload.effective_date ?? null,
    pendingCancel:   false,
    updatedAt:       new Date().toISOString(),
  };
}

function mkUpgradeUrl(installationId: number): string {
  return `https://github.com/marketplace/${APP_SLUG}/upgrade/${installationId}/`;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────
// createNodeMiddleware (below) verifies X-Hub-Signature-256 against WEBHOOK_SECRET
// before dispatching to these handlers. GitHub may redeliver failed events, so
// all handlers are idempotent by design.

ghApp.webhooks.on('marketplace_purchase.purchased' as any, async ({ payload }: { payload: any }) => {
  const mp  = payload.marketplace_purchase;
  const key = storeKey(mp.account.type, mp.account.id);
  await store.set(key, recordFromPayload(payload));
  console.log('[webhook] purchased', key, mp.plan?.name);
});

ghApp.webhooks.on('marketplace_purchase.changed' as any, async ({ payload }: { payload: any }) => {
  // Covers: plan upgrades/downgrades, seat-count changes, billing-cycle switches.
  // effective_date may be in the future when the change activates at end of billing period.
  const mp       = payload.marketplace_purchase;
  const key      = storeKey(mp.account.type, mp.account.id);
  const existing = await store.get(key);
  await store.set(key, { ...(existing ?? {}), ...recordFromPayload(payload) });
  console.log('[webhook] changed', key, mp.plan?.name, '| effective:', payload.effective_date ?? 'now');
});

ghApp.webhooks.on('marketplace_purchase.cancelled' as any, async ({ payload }: { payload: any }) => {
  // The subscription stays active until effective_date (end of the current billing period).
  // Mark pendingCancel: true so the /license endpoint can warn the customer while still
  // granting access until the billing period expires.
  const mp       = payload.marketplace_purchase;
  const key      = storeKey(mp.account.type, mp.account.id);
  const existing = await store.get(key);
  await store.set(key, {
    ...(existing ?? recordFromPayload(payload)),
    pendingCancel: true,
    effectiveDate: payload.effective_date ?? null,
    updatedAt:     new Date().toISOString(),
  });
  console.log('[webhook] cancelled (pending)', key, '| access until:', payload.effective_date);
});

ghApp.webhooks.on('marketplace_purchase.pending_change' as any, ({ payload }: { payload: any }) => {
  // A future plan change has been queued but is not yet effective.
  // The 'changed' event will fire when it takes effect; no store update needed here.
  const mp = payload.marketplace_purchase;
  console.log('[webhook] pending_change', storeKey(mp.account.type, mp.account.id),
              mp.plan?.name, '| at:', payload.effective_date);
});

ghApp.webhooks.on('marketplace_purchase.pending_change_cancelled' as any,
  ({ payload }: { payload: any }) => {
    const mp = payload.marketplace_purchase;
    console.log('[webhook] pending_change_cancelled', storeKey(mp.account.type, mp.account.id));
  }
);

ghApp.webhooks.onError(err => {
  console.error('[webhook] error –', err.name, err.message);
});

// ─── Reconciliation ──────────────────────────────────────────────────────────
// Guards against missed webhook deliveries by periodically pulling the
// authoritative subscriber list from GitHub's Marketplace Listing API.
//
// Configure: MARKETPLACE_PLAN_IDS=1234,5678   (comma-separated plan IDs from
//            your Marketplace listing – required to enable reconciliation)
//            RECONCILE_INTERVAL_MS=21600000   (default: 6 hours)
async function reconcile(): Promise<void> {
  const planIds = (process.env.MARKETPLACE_PLAN_IDS ?? '')
    .split(',').map(s => Number(s.trim())).filter(n => n > 0);

  if (!planIds.length) {
    console.info('[reconcile] MARKETPLACE_PLAN_IDS not set – skipping');
    return;
  }

  for (const planId of planIds) {
    let page = 1;
    while (true) {
      try {
        const { data } = await appOctokit.request('GET /marketplace_listing/plans/{plan_id}/accounts', {
          plan_id: planId,
          per_page: 100,
          page,
        });

        for (const entry of data) {
          const acct = entry as any;
          const mp   = (acct.marketplace_purchase ?? {}) as any;
          const key  = storeKey(acct.type, acct.id);

          // Don't overwrite a valid pending-cancel record whose effective_date
          // hasn't passed yet – the reconciliation API still lists the account.
          const existing = await store.get(key);
          if (existing?.pendingCancel && existing.effectiveDate
              && new Date(existing.effectiveDate) > new Date()) {
            continue;
          }

          await store.set(key, {
            plan:            mp.plan?.name          ?? 'unknown',
            accountId:       acct.id,
            accountType:     acct.type,
            accountLogin:    acct.login,
            onFreeTrial:     mp.on_free_trial       ?? false,
            freeTrialEndsOn: mp.free_trial_ends_on  ?? null,
            unitCount:       mp.unit_count          ?? null,
            effectiveDate:   null,
            pendingCancel:   false,
            updatedAt:       new Date().toISOString(),
          });
        }

        if (data.length < 100) break;
        page++;
      } catch (err: any) {
        console.error('[reconcile] plan', planId, 'page', page, '–', err.message);
        break;
      }
    }
  }
  console.info('[reconcile] done for plans:', planIds.join(', '));
}

reconcile();
const RECONCILE_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
setInterval(reconcile, RECONCILE_MS).unref();

// ─── Express server ──────────────────────────────────────────────────────────
const server = express();

// ── Static legal pages ───────────────────────────────────────────────────────
// Registered on `server` (not a separate `app` instance) — `server.listen()` is
// what actually receives traffic. Putting these on a sibling `express()` would
// 404 silently in production with `x-powered-by: Express`.
server.get('/privacy', (_req, res) =>
  res.sendFile(path.join(__dirname, '../public/privacy.html'))
);
server.get('/terms', (_req, res) =>
  res.sendFile(path.join(__dirname, '../public/terms.html'))
);

// createNodeMiddleware verifies X-Hub-Signature-256 before dispatching.
// Path must match hook_attributes.url in docs/manifest.yaml.
server.use(createNodeMiddleware(ghApp.webhooks as any, { path: '/api/webhook' }));

// ─── /setup ──────────────────────────────────────────────────────────────────
/**
 * GET /setup?installation_id=<id>&setup_action=install|update
 *
 * Required for paid Marketplace listings (configure as "Setup URL" in app settings
 * and set setup_on_update: true so it fires on upgrades/downgrades too).
 *
 * GitHub redirects the installing admin here after install or update.
 * The installation_id query param is treated as UNTRUSTED input; the App JWT
 * resolves the installation and account from GitHub's API server-side.
 */
server.get('/setup', async (req, res) => {
  const installationId = Number(req.query.installation_id);
  if (!installationId || Number.isNaN(installationId)) {
    res.status(400).send('<p>Missing or invalid installation_id.</p>');
    return;
  }

  try {
    const { data: inst } = await appOctokit.request('GET /app/installations/{installation_id}', {
      installation_id: installationId,
    });
    const account = inst.account as { login: string; type: string; id: number } | null;
    if (!account) {
      res.status(404).send('<p>Installation not found.</p>');
      return;
    }

    const lic       = await store.get(storeKey(account.type, account.id));
    const plan      = lic?.plan ?? 'free';
    const isTrial   = lic?.onFreeTrial ?? false;
    const isPending = lic?.pendingCancel ?? false;
    const isPaid    = plan !== 'free' && !isPending;
    const upUrl     = mkUpgradeUrl(installationId);
    const badge     = isPaid ? 'paid' : isTrial ? 'trial' : isPending ? 'cancel' : 'free';

    res.type('html').send(`<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Zero Nonsense Licenser – Setup</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:600px;margin:4rem auto;padding:0 1.5rem;color:#24292e}
    .badge{display:inline-block;padding:.2em .6em;border-radius:2em;font-size:.85em;font-weight:600}
    .free{background:#e1e4e8}.paid{background:#d1fae5;color:#065f46}
    .trial{background:#fef3c7;color:#92400e}.cancel{background:#fee2e2;color:#991b1b}
    a.btn{display:inline-block;margin-top:1rem;padding:.5em 1.2em;background:#2ea44f;
          color:#fff;border-radius:6px;text-decoration:none;font-weight:600}
  </style>
</head><body>
  <h1>&#x2705; Installation complete</h1>
  <p>Installed for <strong>${String(account.login)}</strong>.</p>
  <p>Plan: <span class="badge ${badge}">${String(plan)}</span>
    ${isTrial && lic?.freeTrialEndsOn ? ` &nbsp;<small>trial ends ${String(lic.freeTrialEndsOn)}</small>` : ''}
    ${isPending && lic?.effectiveDate ? ` &nbsp;<small>cancels ${String(lic.effectiveDate)}</small>` : ''}
  </p>
  ${!isPaid ? `<p><a class="btn" href="${upUrl}">Upgrade to Pro &#x2192;</a></p>` : ''}
  <hr style="margin:2rem 0">
  <p>Return to <a href="https://github.com/zero-nonsense-dev/releasescribe-action">ReleaseScribe</a> to get started.</p>
</body></html>`);
  } catch (err: any) {
    const httpStatus: number = err.status ?? 500;
    res.status(httpStatus < 500 ? httpStatus : 500)
       .send('<p>Could not verify your installation. Please try reinstalling.</p>');
  }
});

// ─── /license ────────────────────────────────────────────────────────────────
/**
 * GET /license?owner=<login>&repo=<repo>
 * Authorization: Bearer <GITHUB_TOKEN>
 *
 * Called by the ReleaseScribe Action on every workflow run.
 *
 * Trust model – two independent server-side verifications:
 *   1. Caller's GITHUB_TOKEN proves the request originates from a workflow
 *      with real read access to the specified repo (prevents arbitrary
 *      enumeration of other customers' plans).
 *   2. The App JWT resolves the installation account directly from GitHub –
 *      no client-supplied account_id or installation_id is ever trusted.
 */
server.get('/license', async (req, res) => {
  const { owner, repo } = req.query as { owner?: string; repo?: string };
  const authHeader      = req.headers.authorization ?? '';

  if (!authHeader.startsWith('Bearer ') || !owner || !repo) {
    res.status(400).json({
      ok: false,
      error: 'Provide Authorization: Bearer <GITHUB_TOKEN> and ?owner=<login>&repo=<repo>',
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    // Step 1: confirm the token has real read access to this repo
    const callerOctokit = new Octokit({ auth: token });
    await callerOctokit.rest.repos.get({ owner, repo });

    // Step 2: resolve the app installation server-side via App JWT (no client ID trusted)
    const { data: installation } = await appOctokit.request('GET /repos/{owner}/{repo}/installation', {
      owner,
      repo,
    });
    const account = installation.account as { login: string; type: string; id: number } | null;
    if (!account) {
      res.status(404).json({ ok: false, error: 'App not installed for this repository' });
      return;
    }

    const lic       = await store.get(storeKey(account.type, account.id));
    const plan      = lic?.plan ?? 'free';
    const isPending = lic?.pendingCancel ?? false;

    res.json({
      ok:              true,
      plan,
      pendingCancel:   isPending,
      onFreeTrial:     lic?.onFreeTrial     ?? false,
      freeTrialEndsOn: lic?.freeTrialEndsOn ?? null,
      upgradeUrl:      plan === 'free' || isPending ? mkUpgradeUrl(installation.id) : null,
      account:         account.login,
    });
  } catch (err: any) {
    const status: number = err.status ?? 500;
    if (status === 401 || status === 403) {
      res.status(401).json({ ok: false, error: 'Invalid or insufficient GitHub token' });
      return;
    }
    if (status === 404) {
      res.status(404).json({ ok: false, error: 'Repository not found or app not installed' });
      return;
    }
    console.error('[license]', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => console.log(`Billing app listening on :${PORT}`));
