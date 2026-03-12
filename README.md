# AI Code Reviewer GitHub Action (Azure OpenAI)

This repository contains a billing-aware AI code reviewer designed to be distributed with your GitHub App in the `zerononsense.dev` organization.

## What It Does

- Reviews pull request diffs only, not entire repository contents.
- Calls Azure OpenAI using your deployment in `westeurope`.
- Enforces billing entitlement and plan-based limits through `billing.zerononsense.dev`.
- Posts line-level PR comments and a summary comment.
- Fails checks on severe findings (`high`, `critical`) by default.
- Writes audit logs to Azure Log Analytics (optional but recommended).

## Inputs

See `action.yml` for the full contract.

Important inputs:

- `github-token`
- `azure-openai-endpoint`
- `azure-openai-api-key`
- `azure-openai-deployment`
- `billing-endpoint`
- `plan-limits-json`
- `review-types`
- `review-profiles-path`
- `comment-mode`
- `fail-on-severities`

## Quick Start (Consumer Repository)

Use this from a workflow:

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: zero-nonsense-dev/ai-code-reviewer@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          azure-openai-endpoint: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          azure-openai-api-key: ${{ secrets.AZURE_OPENAI_API_KEY }}
          azure-openai-deployment: ${{ vars.AZURE_OPENAI_DEPLOYMENT }}
```

## Plan Limits

Findings and file limits are enforced per plan:

| Plan | Max Findings/Run | Max Files Scanned |
|------|---:|---:|
| free | 20 | 30 |
| pro | 100 | 150 |
| enterprise | 500 | 500 |

Configure via `plan-limits-json` input:
```json
{
  "free": {"maxFindings": 20, "maxFilesScanned": 30},
  "pro": {"maxFindings": 100, "maxFilesScanned": 150},
  "enterprise": {"maxFindings": 500, "maxFilesScanned": 500}
}
```

## Provision Azure Resources with azd

1. Install and sign in to Azure Developer CLI:

```bash
azd auth login
```

2. Initialize environment and provision infra:

```bash
azd env new prod
azd provision
```

3. Capture outputs and configure GitHub secrets/variables:

- `AZURE_OPENAI_ENDPOINT` -> output `azureOpenAIEndpoint`
- `AZURE_OPENAI_DEPLOYMENT` -> output `azureOpenAIDeployment`
- `LOG_ANALYTICS_WORKSPACE_ID` -> output `logAnalyticsWorkspaceId`
- `AZURE_OPENAI_API_KEY` -> use Azure portal key for OpenAI account
- `LOG_ANALYTICS_SHARED_KEY` -> workspace shared key in Azure portal

## API Failure Handling (Fail-Open)

By design, if the Azure OpenAI API is unavailable, times out, or returns an error:
- The check **passes** with a warning message
- The PR is **not blocked**
- An audit log entry records the failure for monitoring

This "fail-open" approach ensures transient API issues don't block critical hotfixes. Developers can still merge while the AI service recovers.

## Billing Integration

The action checks entitlement using:

- `GET https://billing.zerononsense.dev/license?owner=<owner>&repo=<repo>`
- `Authorization: Bearer <GITHUB_TOKEN>`

Expected success payload:

```json
{
  "ok": true,
  "plan": "pro",
  "pendingCancel": false,
  "onFreeTrial": false,
  "freeTrialEndsOn": null,
  "upgradeUrl": null,
  "account": "zero-nonsense-dev"
}
```

If entitlement fails, the action fails early.

## Security and Compliance Defaults

- Does not send full repository context, only filtered diffs.
- Supports exclude patterns for secrets and generated files.
- Recommends EU region (`westeurope`) for residency.
- Avoids logging secrets in prompts.
- Supports 30-day audit retention via Log Analytics.

## Marketplace and App Packaging

See `docs/marketplace.md` for listing content and rollout checklist.
