# Marketplace Packaging Guide

This document helps package and sell the AI code reviewer through your GitHub App (`billing-ap`) for the `zerononsense.dev` organization.

## Product Positioning

- Product: `AI Code Reviewer (Azure OpenAI)`
- Delivery: GitHub Action + billing entitlement via `billing.zerononsense.dev`
- Hosting: Single-tenant Azure subscription, EU residency (`westeurope`)
- Model: OpenAI GPT-4o-mini (Azure-hosted, cost-optimized for review tasks)

## Model & Provider Options

### Current Setup (Azure OpenAI)
- **Model**: GPT-4o-mini
- **Endpoint**: `https://{resourceName}.openai.azure.com` (your Azure subscription)
- **Region**: `westeurope` (EU data residency)
- **Cost**: Pay-per-token (Azure OpenAI pricing)
- **Latency**: Low (regional endpoint)

### Alternative Models (Require Custom Config)
If you want to switch models:

| Provider | Model | Endpoint | EU Residency | Cost | Setup |
|---|---|---|---|---|---|
| **Azure OpenAI** | GPT-4o, GPT-4, GPT-3.5-turbo | Azure region endpoint | ✅ Yes | Azure pricing | Update `infra/main.bicep` |
| **GitHub Models API** | Claude 3.5 Sonnet, Llama 2, Mistral | `api.github.com` | ⚠️ No | Free tier available | Extend `action.yml` input |
| **Anthropic** | Claude 3 Opus, Sonnet, Haiku | `api.anthropic.com` | ❌ No | Pay-per-token | Extend `action.yml` + new Bicep |

**Recommendation**: Stick with Azure OpenAI (current) for EU compliance and lower latency. Claude or GitHub Models require separate action inputs and infrastructure changes. Contact us if you need multi-provider support.

## Plan Matrix Template

| Plan | Findings/Run | Max Files Scanned | Comment Mode | Merge Blocking |
|---|---:|---:|---|---|
| free | 20 | 30 | summary | off |
| pro | 100 | 150 | both | high+critical |
| enterprise | 500 | 500 | both | configurable |

Use `plan-limits-json` input to enforce findings/run by plan.

## Required App/Action Permissions

- `contents: read`
- `pull-requests: write`
- `issues: write`

## Required Secrets and Variables (Consumer Repo)

Secrets:

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `LOG_ANALYTICS_WORKSPACE_ID` (optional)
- `LOG_ANALYTICS_SHARED_KEY` (optional)

Variables:

- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`

## Operational Checklist

1. Provision Azure resources with `azd provision`.
2. Set repository or organization secrets/variables.
3. Install/configure your GitHub App on customer repos.
4. Confirm billing endpoint returns `ok: true` for entitled repos.
5. Trigger test PR and verify inline + summary comments.
6. Verify audit records in Log Analytics custom table.

## API Failure Handling (Fail-Open)

By design, if the Azure OpenAI API is unavailable or times out:
- The GitHub check will **pass** with a warning in the logs
- No PR will be blocked
- An audit log entry is recorded with status `api_error`
- A comment on the PR explains the temporary issue

This "fail-open" approach ensures PR reviews don't become a blocker during transient API outages. Developers can still merge critical fixes while the AI service recovers.

## Listing Copy Starter

Short description:

`AI-powered PR reviews with Azure OpenAI, billing-aware controls, and enterprise audit logging.`

Value bullets:

- Detects bugs and security issues in pull request diffs.
- Posts line-level review comments where developers work.
- Enforces plan quotas through your billing API.
- Supports EU data residency and audit retention defaults.

## Support and SLA Template

- Support email: `support@zerononsense.dev`
- Incident target: P1 response in 4 business hours
- Status page: `status.zerononsense.dev` (if available)
