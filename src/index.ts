
import express from 'express';
import { App } from '@octokit/app';
import { createNodeMiddleware } from '@octokit/webhooks';

// ENV required: APP_ID, PRIVATE_KEY (PEM), CLIENT_ID, CLIENT_SECRET, WEBHOOK_SECRET

const app = express();

// Minimal in-memory license store (replace with persistent storage)
const licenses = new Map<string, { plan: string; accountId: number }>();

const ghApp = new App({
  appId: process.env.APP_ID!,
  privateKey: process.env.PRIVATE_KEY!,
  oauth: { clientId: process.env.CLIENT_ID!, clientSecret: process.env.CLIENT_SECRET! },
  webhooks: { secret: process.env.WEBHOOK_SECRET! }
});

const webhooks = ghApp.webhooks;
webhooks.on(['marketplace_purchase.purchased', 'marketplace_purchase.changed', 'marketplace_purchase.cancelled'], async ({ payload }) => {
  const acct = payload.marketplace_purchase.account;
  const plan = payload.marketplace_purchase.plan?.name || 'free';
  const key = `${acct.type}:${acct.id}`;
  if ((payload as any).action === 'cancelled') {
    licenses.delete(key);
    console.log('License cancelled', key);
  } else {
    licenses.set(key, { plan, accountId: acct.id });
    console.log('License updated', key, plan);
  }
});

app.use(createNodeMiddleware(webhooks));

app.get('/license', async (req, res) => {
  try {
    const accountId = Number(req.query.account_id);
    const accountType = (req.query.account_type as string) || 'Organization';
    const key = `${accountType}:${accountId}`;
    const lic = licenses.get(key);
    res.json({ ok: true, plan: lic?.plan || 'free' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Billing app listening on :${PORT}`));
