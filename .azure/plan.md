# Azure Deployment Plan — billing-app

## Goal
Deploy the Zero Nonsense Licenser billing app to Azure Container Apps (Consumption)
at `https://billing.zerononsense.dev`, leaving the existing GoDaddy website at
`zerononsense.dev` untouched.

## Service choices (with rationale)

| Resource | SKU | Cost/month | Why |
|---|---|---|---|
| Container Registry | Basic | ~€5.50 | Private image storage |
| Container Apps Environment | Consumption | €0 | No base fee; pay-per-use |
| Container App | Consumption | ~€0 | Scales to 0; webhook traffic is tiny |
| Key Vault | Standard | ~€0 | Secret storage; ~€0.003/10k ops |
| Managed Identity | System-assigned | free | Keyless secret access |

**Total: ~€5–6/month**

## Status

- [ ] Step 1: Dockerfile
- [ ] Step 2: Bicep — infra/main.bicep + infra/main.parameters.json
- [ ] Step 3: azure.yaml
- [ ] Step 4: Update docs/manifest.yaml URLs
- [ ] Step 5: Run `azd up`
- [ ] Step 6: Add custom domain + managed cert in Azure portal
- [ ] Step 7: GoDaddy DNS — add CNAME billing → Container App FQDN

## Required inputs

| Input | Value |
|---|---|
| Azure subscription | (your subscription) |
| Location | westeurope (closest to .dev audience) |
| App URL | https://billing.zerononsense.dev |
| Webhook path | /api/webhook |
| Setup path | /setup |

## Secrets to store in Key Vault (after `azd up`)

- `APP-ID`
- `PRIVATE-KEY`
- `CLIENT-ID`
- `CLIENT-SECRET`
- `WEBHOOK-SECRET`
- `APP-SLUG` = `zero-nonsense-licenser`
- `MARKETPLACE-PLAN-IDS` = comma-separated plan IDs (after listing is created)
