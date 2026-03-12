import * as core from "@actions/core";
import * as github from "@actions/github";
import { minimatch } from "minimatch";
import { createHmac, createHash } from "crypto";
import { existsSync, readFileSync } from "fs";

type Severity = "info" | "low" | "medium" | "high" | "critical";

type ReviewFinding = {
  path: string;
  line: number;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  suggestion?: string;
};

type ModelResult = {
  summary: string;
  findings: ReviewFinding[];
};

type BillResponse = {
  ok: boolean;
  plan?: string;
  pendingCancel?: boolean;
  onFreeTrial?: boolean;
  freeTrialEndsOn?: string | null;
  upgradeUrl?: string | null;
  account?: string;
  error?: string;
};

type PRFile = {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
  changes: number;
};

type HunkInfo = {
  changedLines: Set<number>;
  hunkText: string;
};

type ReviewProfile = {
  name: string;
  patterns: string[];
  reviewTypes: string[];
};

type PlanOptions = {
  maxFindings: number;
  maxFilesScanned: number;
};

type Config = {
  githubToken: string;
  azureEndpoint: string;
  azureApiKey: string;
  azureDeployment: string;
  azureApiVersion: string;
  billingEndpoint: string;
  maxFindingsPerRun: number;
  planLimits: Record<string, PlanOptions>;
  reviewTypes: string[];
  reviewProfilesPath: string;
  reviewProfiles: ReviewProfile[];
  commentMode: "inline" | "summary" | "both";
  failOnSeverities: Set<Severity>;
  includePatterns: string[];
  excludePatterns: string[];
  logAnalyticsWorkspaceId?: string;
  logAnalyticsSharedKey?: string;
  logAnalyticsTable: string;
};

const DEFAULT_PLAN_LIMITS: Record<string, PlanOptions> = {
  free: { maxFindings: 20, maxFilesScanned: 30 },
  pro: { maxFindings: 100, maxFilesScanned: 150 },
  enterprise: { maxFindings: 500, maxFilesScanned: 500 },
};

function input(name: string, required = false): string {
  return core.getInput(name, { required }).trim();
}

function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parsePlanLimits(raw: string): Record<string, PlanOptions> {
  if (!raw) {
    return DEFAULT_PLAN_LIMITS;
  }

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const parsed: Record<string, PlanOptions> = {};
    for (const [plan, opts] of Object.entries(value)) {
      if (!opts || typeof opts !== "object") continue;
      const obj = opts as Record<string, unknown>;
      const findings = Number(obj.maxFindings ?? 0);
      const files = Number(obj.maxFilesScanned ?? 0);
      if (Number.isFinite(findings) && findings > 0 && Number.isFinite(files) && files > 0) {
        parsed[String(plan).toLowerCase()] = { maxFindings: Math.floor(findings), maxFilesScanned: Math.floor(files) };
      }
    }
    return Object.keys(parsed).length > 0 ? parsed : DEFAULT_PLAN_LIMITS;
  } catch {
    core.warning("Invalid plan-limits-json; defaulting to built-in plan limits.");
    return DEFAULT_PLAN_LIMITS;
  }
}

function loadReviewProfiles(profilePath: string): ReviewProfile[] {
  if (!profilePath || !existsSync(profilePath)) {
    return [];
  }

  try {
    const raw = readFileSync(profilePath, "utf8");
    const parsed = JSON.parse(raw) as { profiles?: unknown };
    if (!Array.isArray(parsed.profiles)) {
      return [];
    }

    return parsed.profiles
      .map((p) => {
        if (!p || typeof p !== "object") {
          return undefined;
        }
        const value = p as Record<string, unknown>;
        const patterns = Array.isArray(value.patterns)
          ? value.patterns.map((x) => String(x)).filter(Boolean)
          : [];
        const reviewTypes = Array.isArray(value.reviewTypes)
          ? value.reviewTypes.map((x) => String(x)).filter(Boolean)
          : [];

        if (patterns.length === 0 || reviewTypes.length === 0) {
          return undefined;
        }

        return {
          name: String(value.name ?? "default"),
          patterns,
          reviewTypes,
        } satisfies ReviewProfile;
      })
      .filter((v): v is ReviewProfile => Boolean(v));
  } catch {
    core.warning(`Could not parse review profiles file at ${profilePath}.`);
    return [];
  }
}

function getConfig(): Config {
  const commentModeRaw = input("comment-mode") || "both";
  const commentMode = ["inline", "summary", "both"].includes(commentModeRaw)
    ? (commentModeRaw as Config["commentMode"])
    : "both";

  const failOnSeverities = new Set(
    parseCsv(input("fail-on-severities") || "high,critical").map((s) =>
      s.toLowerCase()
    )
  ) as Set<Severity>;

  const reviewProfilesPath = input("review-profiles-path") || ".ai-reviewer/profiles.json";

  return {
    githubToken: input("github-token", true),
    azureEndpoint: input("azure-openai-endpoint", true),
    azureApiKey: input("azure-openai-api-key", true),
    azureDeployment: input("azure-openai-deployment", true),
    azureApiVersion: input("azure-openai-api-version") || "2024-10-21",
    billingEndpoint: input("billing-endpoint") || "https://billing.zerononsense.dev/license",
    maxFindingsPerRun: Number(input("max-findings-per-run") || "100"),
    planLimits: parsePlanLimits(input("plan-limits-json")),
    reviewTypes: parseCsv(input("review-types") || "bugs,security,test-gaps"),
    reviewProfilesPath,
    reviewProfiles: loadReviewProfiles(reviewProfilesPath),
    commentMode,
    failOnSeverities,
    includePatterns: parseCsv(input("include-patterns")),
    excludePatterns: parseCsv(input("exclude-patterns")),
    logAnalyticsWorkspaceId: input("log-analytics-workspace-id") || undefined,
    logAnalyticsSharedKey: input("log-analytics-shared-key") || undefined,
    logAnalyticsTable: input("log-analytics-table") || "AiCodeReviewerAudit",
  };
}

function shouldIncludeFile(filePath: string, includePatterns: string[], excludePatterns: string[]): boolean {
  const included = includePatterns.length === 0 || includePatterns.some((p) => minimatch(filePath, p));
  if (!included) {
    return false;
  }
  const excluded = excludePatterns.some((p) => minimatch(filePath, p));
  return !excluded;
}

function parsePatch(patch: string): HunkInfo {
  const lines = patch.split("\n");
  const changed = new Set<number>();
  let newLine = 0;

  for (const line of lines) {
    const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkHeader) {
      newLine = Number(hunkHeader[1]);
      continue;
    }
    if (line.startsWith("+")) {
      changed.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      continue;
    }
    newLine += 1;
  }

  return {
    changedLines: changed,
    hunkText: patch,
  };
}

async function getBillingPlan(config: Config, owner: string, repo: string): Promise<BillResponse> {
  const url = new URL(config.billingEndpoint);
  url.searchParams.set("owner", owner);
  url.searchParams.set("repo", repo);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      "Content-Type": "application/json",
    },
  });

  let body: BillResponse;
  try {
    body = (await res.json()) as BillResponse;
  } catch {
    body = { ok: false, error: `Invalid billing response (status ${res.status})` };
  }

  if (!res.ok || !body.ok) {
    throw new Error(`Billing check failed: ${body.error ?? `HTTP ${res.status}`}`);
  }

  return body;
}

function sanitizePatch(patch: string): string {
  return patch
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*["'][^"']+["']/gi, "$1: \"[REDACTED]\"")
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/g, "Bearer [REDACTED]");
}

function resolveReviewFocus(path: string, globalReviewTypes: string[], profiles: ReviewProfile[]): string[] {
  const profile = profiles.find((p) => p.patterns.some((pattern) => minimatch(path, pattern)));
  return profile ? profile.reviewTypes : globalReviewTypes;
}

function buildPrompt(
  reviewTypes: string[],
  profiles: ReviewProfile[],
  files: Array<{ path: string; patch: string }>,
  maxFindings: number
): string {
  const globalFocus = reviewTypes.join(", ");
  const chunks = files
    .map((f) => {
      const focus = resolveReviewFocus(f.path, reviewTypes, profiles).join(", ");
      return `FILE: ${f.path}\nFOCUS: ${focus}\nDIFF:\n${sanitizePatch(f.patch)}`;
    })
    .join("\n\n");

  return [
    "You are an expert pull request reviewer.",
    `Global focus: ${globalFocus}.`,
    "Each file includes a FOCUS line that can override global focus.",
    "Only report concrete findings based on provided diffs.",
    "Do not invent files, methods, or lines not present in the input.",
    "Return strict JSON only using this schema:",
    "{\"summary\": string, \"findings\": [{\"path\": string, \"line\": number, \"severity\": \"info|low|medium|high|critical\", \"category\": string, \"title\": string, \"detail\": string, \"suggestion\"?: string}]}",
    `Limit findings to at most ${maxFindings}.`,
    "Prefer high signal findings over style nits.",
    "Input diffs:",
    chunks,
  ].join("\n");
}

async function callAzureOpenAI(config: Config, prompt: string): Promise<ModelResult> {
  const endpoint = config.azureEndpoint.replace(/\/$/, "");
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(
    config.azureDeployment
  )}/chat/completions?api-version=${encodeURIComponent(config.azureApiVersion)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": config.azureApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a precise PR reviewer. Return valid JSON only. No markdown, no backticks.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 2400,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Azure OpenAI call failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model response was empty");
    }

    const parsed = parseModelResult(content);
    return parsed;
  } catch (err) {
    // Fail-open: Return empty findings if API fails; the check will pass with a warning
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`Azure OpenAI request failed (fail-open): ${message}`);
    return { summary: "AI review could not be completed (API unavailable).", findings: [] };
  }
}

function parseModelResult(raw: string): ModelResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model response could not be parsed as JSON");
    }
    data = JSON.parse(match[0]);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Model response shape invalid");
  }

  const summary = typeof (data as { summary?: unknown }).summary === "string"
    ? (data as { summary: string }).summary
    : "AI review completed.";

  const findingsRaw = Array.isArray((data as { findings?: unknown }).findings)
    ? ((data as { findings: unknown[] }).findings)
    : [];

  const findings = findingsRaw
    .map((f): ReviewFinding | undefined => {
      if (!f || typeof f !== "object") {
        return undefined;
      }
      const value = f as Record<string, unknown>;
      const path = String(value.path ?? "").trim();
      const line = Number(value.line ?? 0);
      const severity = String(value.severity ?? "").toLowerCase();
      const allowed: Severity[] = ["info", "low", "medium", "high", "critical"];
      if (!path || !Number.isFinite(line) || line <= 0 || !allowed.includes(severity as Severity)) {
        return undefined;
      }

      const finding: ReviewFinding = {
        path,
        line,
        severity: severity as Severity,
        category: String(value.category ?? "general"),
        title: String(value.title ?? "Finding"),
        detail: String(value.detail ?? ""),
      };

      if (value.suggestion) {
        finding.suggestion = String(value.suggestion);
      }

      return finding;
    })
    .filter((x): x is ReviewFinding => Boolean(x));

  return {
    summary,
    findings,
  };
}

function findingsToMarkdown(summary: string, findings: ReviewFinding[]): string {
  const ordered = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const rows = ordered
    .map(
      (f, idx) =>
        `${idx + 1}. [${f.severity.toUpperCase()}] ${f.path}:${f.line} - ${f.title}\n${f.detail}${
          f.suggestion ? `\nSuggestion: ${f.suggestion}` : ""
        }`
    )
    .join("\n\n");

  return [`## AI Code Review`, summary, rows || "No findings.", "_Generated by zerononsense.dev AI Code Reviewer_"].join(
    "\n\n"
  );
}

function severityRank(severity: Severity): number {
  switch (severity) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
    default:
      return 1;
  }
}

function toReviewComments(findings: ReviewFinding[]): Array<{ path: string; line: number; side: "RIGHT"; body: string }> {
  return findings.map((f) => ({
    path: f.path,
    line: f.line,
    side: "RIGHT",
    body: `**${f.severity.toUpperCase()} | ${f.category}**\n\n**${f.title}**\n\n${f.detail}${
      f.suggestion ? `\n\nSuggested fix: ${f.suggestion}` : ""
    }`,
  }));
}

function computeRunHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function writeAuditLog(
  config: Config,
  record: Record<string, unknown>
): Promise<void> {
  if (!config.logAnalyticsWorkspaceId || !config.logAnalyticsSharedKey) {
    return;
  }

  const body = JSON.stringify([record]);
  const date = new Date().toUTCString();
  const contentType = "application/json";
  const resource = "/api/logs";
  const xHeaders = `x-ms-date:${date}`;
  const stringToSign = `POST\n${Buffer.byteLength(body, "utf8")}\n${contentType}\n${xHeaders}\n${resource}`;

  const key = Buffer.from(config.logAnalyticsSharedKey, "base64");
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("base64");
  const auth = `SharedKey ${config.logAnalyticsWorkspaceId}:${signature}`;

  const endpoint = `https://${config.logAnalyticsWorkspaceId}.ods.opinsights.azure.com${resource}?api-version=2016-04-01`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: auth,
      "Log-Type": config.logAnalyticsTable,
      "x-ms-date": date,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    core.warning(`Failed to write audit log to Log Analytics: ${res.status} ${text}`);
  }
}

function selectPlanLimit(config: Config, plan?: string): number {
  if (!plan) {
    return config.maxFindingsPerRun;
  }
  const planKey = plan.toLowerCase();
  return config.planLimits[planKey]?.maxFindings ?? config.maxFindingsPerRun;
}

function resolvePrNumber(payload: typeof github.context.payload): number | undefined {
  if (payload.pull_request?.number) {
    return payload.pull_request.number;
  }
  if (payload.issue?.number && payload.issue.pull_request) {
    return payload.issue.number;
  }
  return undefined;
}

async function run(): Promise<void> {
  const config = getConfig();
  const context = github.context;

  const prNumber = resolvePrNumber(context.payload);
  if (!prNumber) {
    core.info("No pull request context found; skipping.");
    return;
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const octokit = github.getOctokit(config.githubToken);

  const entitlement = await getBillingPlan(config, owner, repo);
  const planLimit = selectPlanLimit(config, entitlement.plan);

  const allFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  }) as PRFile[];

  // Apply per-plan file scan limit
  const maxFilesForPlan = (() => {
    const planKey = (entitlement.plan ?? "free").toLowerCase();
    return config.planLimits[planKey]?.maxFilesScanned ?? config.planLimits.free.maxFilesScanned;
  })();

  const selectedFiles = allFiles
    .filter((f) => Boolean(f.patch) && shouldIncludeFile(f.filename, config.includePatterns, config.excludePatterns))
    .slice(0, maxFilesForPlan)
    .map((f) => ({ path: f.filename, patch: f.patch as string }));

  if (selectedFiles.length === 0) {
    core.info("No eligible changed files to review after filters.");
    return;
  }

  const prompt = buildPrompt(config.reviewTypes, config.reviewProfiles, selectedFiles, planLimit);
  const model = await callAzureOpenAI(config, prompt);

  const patchByFile = new Map<string, HunkInfo>();
  for (const f of selectedFiles) {
    patchByFile.set(f.path, parsePatch(f.patch));
  }

  const validatedFindings = model.findings
    .filter((f) => {
      const hunk = patchByFile.get(f.path);
      return Boolean(hunk?.changedLines.has(f.line));
    })
    .slice(0, planLimit);

  const markdown = findingsToMarkdown(model.summary, validatedFindings);

  if (config.commentMode === "inline" || config.commentMode === "both") {
    const comments = toReviewComments(validatedFindings).slice(0, 30);
    if (comments.length > 0) {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: "COMMENT",
        comments,
      });
    }
  }

  if (config.commentMode === "summary" || config.commentMode === "both") {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: markdown,
    });
  }

  const shouldFail = validatedFindings.some((f) => config.failOnSeverities.has(f.severity));

  const auditRecord = {
    TimeGenerated: new Date().toISOString(),
    owner,
    repo,
    pullRequest: prNumber,
    plan: entitlement.plan ?? "unknown",
    findingsCount: validatedFindings.length,
    highestSeverity: validatedFindings.length
      ? validatedFindings.reduce((acc, f) => (severityRank(f.severity) > severityRank(acc) ? f.severity : acc), "info" as Severity)
      : "none",
    runHash: computeRunHash({ owner, repo, prNumber, findings: validatedFindings }),
    reviewTypes: config.reviewTypes.join(","),
    commentMode: config.commentMode,
    failCheck: shouldFail,
  };

  await writeAuditLog(config, auditRecord);

  core.setOutput("plan", entitlement.plan ?? "unknown");
  core.setOutput("findings-count", String(validatedFindings.length));

  if (shouldFail) {
    core.setFailed(
      `Blocking findings detected (${validatedFindings
        .filter((f) => config.failOnSeverities.has(f.severity))
        .length}).`
    );
  }
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
