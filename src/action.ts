import * as core   from '@actions/core';
import { context } from '@actions/github';
import { Octokit } from '@octokit/rest';

// ─── Plan limits ─────────────────────────────────────────────────────────────

const PLAN_LIMITS = {
  free: { maxFiles: 5,        sarif: false, policyPacks: false, fixHints: false },
  pro:  { maxFiles: 50,       sarif: true,  policyPacks: true,  fixHints: true  },
  org:  { maxFiles: Infinity, sarif: true,  policyPacks: true,  fixHints: true  },
} as const;

type Plan = keyof typeof PLAN_LIMITS;

function isPlan(s: string): s is Plan {
  return s in PLAN_LIMITS;
}

// ─── Billing resolution ──────────────────────────────────────────────────────

async function resolvePlan(
  billingUrl: string,
  token:      string,
  owner:      string,
  repo:       string,
  failOpen:   boolean,
): Promise<Plan> {
  const url = `${billingUrl}/license?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { ok: boolean; plan?: string };
    if (!body.ok || !body.plan) throw new Error('Unexpected billing payload');
    return isPlan(body.plan) ? body.plan : 'free';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (failOpen) {
      core.warning(`[billing] API unreachable (${msg}) — failing open with free-tier limits.`);
      return 'free';
    }
    throw new Error(`Billing API failed: ${msg}`);
  }
}

// ─── AI model call ───────────────────────────────────────────────────────────

async function callAI(
  prompt: string,
  apiKey: string | undefined,
  token:  string,
): Promise<string> {
  const [endpoint, auth] = apiKey
    ? ['https://api.openai.com/v1/chat/completions',                  apiKey]
    : ['https://models.inference.ai.azure.com/chat/completions', token];

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
    body:    JSON.stringify({
      model:      'gpt-4o',
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`AI API returned HTTP ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '(no response)';
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(
  filename:    string,
  patch:       string,
  policyPacks: boolean,
  fixHints:    boolean,
): string {
  return [
    `You are a senior code reviewer. Review only the following diff for \`${filename}\`.`,
    'Focus on correctness, security, performance, and readability.',
    ...(policyPacks ? ['- Flag naming, error-handling, and security policy violations.'] : []),
    ...(fixHints    ? ['- For every issue, provide a concrete fix in a fenced code block.'] : []),
    'Be concise. Use bullet points.',
    '',
    '```diff',
    patch.slice(0, 4_000),   // guard against enormous patches
    '```',
  ].join('\n');
}

// ─── File review loop ────────────────────────────────────────────────────────

interface ReviewComment { filename: string; body: string }

async function reviewFiles(
  octokit:  Octokit,
  owner:    string,
  repo:     string,
  prNumber: number,
  apiKey:   string | undefined,
  token:    string,
  plan:     Plan,
): Promise<{ comments: ReviewComment[]; totalFiles: number }> {
  const limits = PLAN_LIMITS[plan];

  const { data: files } = await octokit.rest.pulls.listFiles({
    owner, repo, pull_number: prNumber, per_page: 100,
  });

  const reviewable = files.filter(f => f.patch).slice(0, limits.maxFiles);
  const comments: ReviewComment[] = [];

  for (const file of reviewable) {
    core.info(`  Reviewing ${file.filename}…`);
    try {
      const body = await callAI(
        buildPrompt(file.filename, file.patch!, limits.policyPacks, limits.fixHints),
        apiKey,
        token,
      );
      comments.push({ filename: file.filename, body });
    } catch (err: unknown) {
      core.warning(`  Skipping ${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { comments, totalFiles: files.length };
}

// ─── SARIF output (Pro / Org) ────────────────────────────────────────────────

function buildSarif(
  comments: ReviewComment[],
  owner:    string,
  repo:     string,
): string {
  const results = comments.map(c => ({
    ruleId:    'ai/code-review',
    message:   { text: c.body.slice(0, 1_000) },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: c.filename, uriBaseId: '%SRCROOT%' },
      },
    }],
  }));

  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name:    'AI Code Reviewer',
          version: '1.1.0',
          rules:   [{ id: 'ai/code-review', name: 'AICodeReview' }],
        },
      },
      results,
      versionControlProvenance: [{
        repositoryUri: `https://github.com/${owner}/${repo}`,
      }],
    }],
  });
}

// ─── PR summary comment ──────────────────────────────────────────────────────

async function postSummary(
  octokit:    Octokit,
  owner:      string,
  repo:       string,
  prNumber:   number,
  plan:       Plan,
  reviewed:   number,
  totalFiles: number,
): Promise<void> {
  const skipped = totalFiles - reviewed;
  const rows = [
    `| Plan | \`${plan}\` |`,
    `| Files reviewed | ${reviewed} |`,
    ...(skipped > 0 ? [`| Files skipped (plan limit) | ${skipped} |`] : []),
  ];

  const upgradePrompt = skipped > 0
    ? `\n> **Tip:** Upgrade to **Pro** to review all ${totalFiles} changed files`
      + ` plus policy packs, SARIF export, and inline fix hints`
      + ` → [Marketplace ↗](https://github.com/marketplace/zero-nonsense-licenser)`
    : '';

  const body = [
    '### AI Code Review Summary',
    '',
    '| | |',
    '|---|---|',
    ...rows,
    upgradePrompt,
  ].join('\n');

  await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const token      = core.getInput('github-token',    { required: true });
  const apiKey     = core.getInput('openai-api-key')  || undefined;
  const billingUrl = core.getInput('billing-api-url') || 'https://billing.zerononsense.dev';
  const failOpen   = core.getInput('fail-open') !== 'false';

  if (context.eventName !== 'pull_request' && context.eventName !== 'pull_request_target') {
    core.info('Not a pull_request event — skipping AI review.');
    return;
  }

  const { owner, repo } = context.repo;
  const prNumber        = context.payload.pull_request?.number;
  if (!prNumber) { core.setFailed('Cannot determine PR number.'); return; }

  const octokit = new Octokit({ auth: token });

  core.info('[1/4] Resolving plan…');
  const plan = await resolvePlan(billingUrl, token, owner, repo, failOpen);
  core.setOutput('plan', plan);
  core.info(`      Plan: ${plan} | max files: ${PLAN_LIMITS[plan].maxFiles === Infinity ? '∞' : PLAN_LIMITS[plan].maxFiles}`);

  core.info('[2/4] Reviewing changed files…');
  const { comments, totalFiles } = await reviewFiles(
    octokit, owner, repo, prNumber, apiKey, token, plan,
  );

  core.info('[3/4] Posting inline review comments…');
  for (const { filename, body } of comments) {
    await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber,
      body: `### AI Review: \`${filename}\`\n\n${body}`,
    });
  }

  if (PLAN_LIMITS[plan].sarif && comments.length > 0) {
    core.info('      Uploading SARIF report…');
    try {
      await octokit.rest.codeScanning.uploadSarif({
        owner,
        repo,
        commit_sha: context.sha,
        ref:        context.ref,
        sarif:      Buffer.from(buildSarif(comments, owner, repo)).toString('base64'),
      });
      core.info('      SARIF uploaded.');
    } catch (err: unknown) {
      core.warning(`SARIF upload skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  core.info('[4/4] Posting summary…');
  await postSummary(octokit, owner, repo, prNumber, plan, comments.length, totalFiles);

  core.setOutput('files-reviewed', String(comments.length));
  core.info(`Done. Reviewed ${comments.length}/${totalFiles} files on the '${plan}' plan.`);
}

run().catch(err => core.setFailed(String(err?.message ?? err)));
