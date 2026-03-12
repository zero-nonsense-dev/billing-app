# Production Deployment Guide

This guide walks through provisioning AI Code Reviewer to a test customer's Azure subscription in resource group `rg-code-reviewer-prod`.

## Prerequisites

- Azure subscription access
- Azure CLI installed and authenticated: `az login`
- GitHub repository with this action
- GitHub Actions enabled

## Resource Naming Convention

All resources follow this pattern: `{type}-code-reviewer-prod`

| Type | Resource Name | Service |
|------|---------------|---------|
| `aoai` | `aoai-code-reviewer-prod` | Azure OpenAI Account |
| `law` | `law-code-reviewer-prod` | Log Analytics Workspace |

**Resource Group**: `rg-code-reviewer-prod` (westeurope)

---

## Step 1: Deploy Azure Infrastructure

### Option A: Using PowerShell (Windows)

```powershell
# Navigate to the repo root
cd C:\path\to\ai-code-reviewer

# Run deployment (requires Subscription ID)
.\deploy-prod.ps1 -SubscriptionId "12345678-1234-1234-1234-123456789012"

# Or with custom resource group name:
.\deploy-prod.ps1 -SubscriptionId "..." -ResourceGroup "rg-code-reviewer-prod"
```

### Option B: Using Bash (Linux/macOS)

```bash
# Navigate to the repo root
cd /path/to/ai-code-reviewer

# Make script executable
chmod +x deploy-prod.sh

# Run deployment
./deploy-prod.sh "12345678-1234-1234-1234-123456789012"

# Or with custom resource group:
./deploy-prod.sh "12345678-1234-1234-1234-123456789012" "rg-code-reviewer-prod"
```

### Option C: Manual Azure CLI Deployment

```bash
SUBSCRIPTION_ID="12345678-1234-1234-1234-123456789012"
RESOURCE_GROUP="rg-code-reviewer-prod"
LOCATION="westeurope"

# Set subscription
az account set --subscription $SUBSCRIPTION_ID

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Deploy Bicep template
az deployment group create \
  --resource-group $RESOURCE_GROUP \
  --template-file ./infra/main.bicep \
  --parameters ./infra/main.parameters.json
```

---

## Step 2: Extract and Store Secrets

After deployment, you'll see output like:

```
AZURE_OPENAI_ENDPOINT = https://aoai-code-reviewer-prod.openai.azure.com
AZURE_OPENAI_DEPLOYMENT = gpt-4o-mini-prod
LOG_ANALYTICS_WORKSPACE_ID = 12345678-1234-5678-1234-567812345678
```

### Get API Keys from Azure Portal

1. **Azure OpenAI API Key**:
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to `aoai-code-reviewer-prod`
   - Click "Keys and Endpoint"
   - Copy either **Key 1** or **Key 2**

2. **Log Analytics Shared Key**:
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to `law-code-reviewer-prod`
   - Click "Agents management" → "Windows servers"
   - Copy the **Workspace ID** and **Primary Key**

---

## Step 3: Configure GitHub Repository

Add these secrets to your GitHub repository:

**Settings → Secrets and variables → Actions**

### Secrets (Encrypted)

| Name | Value |
|------|-------|
| `AZURE_OPENAI_ENDPOINT` | `https://aoai-code-reviewer-prod.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | *(paste from Azure Portal)* |
| `LOG_ANALYTICS_WORKSPACE_ID` | *(paste from Azure Portal)* |
| `LOG_ANALYTICS_SHARED_KEY` | *(paste from Azure Portal)* |
| `BILLING_ENDPOINT` | `https://billing.zerononsense.dev/license` |

### Variables (Plain Text)

| Name | Value |
|------|-------|
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o-mini-prod` |
| `AZURE_OPENAI_API_VERSION` | `2024-10-21` |

---

## Step 4: Test the Workflow

1. **Create a test PR**:
   ```bash
   git checkout -b test/ai-review
   echo "# Test PR" >> README.md
   git add README.md
   git commit -m "test: trigger AI reviewer"
   git push origin test/ai-review
   ```

2. **Create PR on GitHub**:
   - Go to your repository
   - Click "New Pull Request"
   - Select your `test/ai-review` branch
   - Create the PR

3. **Verify the workflow**:
   - Go to **Actions** tab
   - Click the "Test AI Code Reviewer (Production)" workflow
   - Wait for completion
   - Check for PR comments with review findings

---

## Troubleshooting

### Workflow doesn't trigger
- Ensure `.github/workflows/test-ai-reviewer.yml` is in the default branch
- Check workflow file syntax: `Actions → Test AI Code Reviewer → Check syntax`

### "404 Not Found" on Azure OpenAI
- Verify `aoai-code-reviewer-prod` exists in resource group
- Verify `AZURE_OPENAI_ENDPOINT` secret is correct

### "Unauthorized" or "API key invalid"
- Re-copy `AZURE_OPENAI_API_KEY` from Azure Portal
- Ensure it's set as a **Secret** (not variable)

### No findings in PR comment
- Check action logs: **Actions → Test AI Code Reviewer → Run AI Code Reviewer**
- Verify billing endpoint returns valid entitlement
- Check if file patterns are matching your PR changes

### Log Analytics not recording
- Verify `LOG_ANALYTICS_WORKSPACE_ID` and `LOG_ANALYTICS_SHARED_KEY` are correct
- Check Log Analytics workspace exists: `az monitor log-analytics workspace list`

---

## Resource Cleanup

To delete all resources after testing:

```bash
az group delete --name rg-code-reviewer-prod --yes
```

This removes:
- Azure OpenAI account (`aoai-code-reviewer-prod`)
- Log Analytics workspace (`law-code-reviewer-prod`)
- All associated resources

---

## Next Steps

- [Read the Marketplace Guide](../docs/marketplace.md)
- [Review the Action Inputs](../action.yml)
- [Configure Monorepo Profiles](../.ai-reviewer/profiles.json)
