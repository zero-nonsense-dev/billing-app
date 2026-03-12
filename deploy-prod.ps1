# Deploy AI Code Reviewer to Azure (Production)
# Usage: .\deploy-prod.ps1 -SubscriptionId <id> -ResourceGroup rg-code-reviewer-prod

param(
    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "rg-code-reviewer-prod",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "westeurope"
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Deploying AI Code Reviewer (Production)" -ForegroundColor Cyan
Write-Host "   Resource Group: $ResourceGroup" -ForegroundColor Cyan
Write-Host "   Subscription: $SubscriptionId" -ForegroundColor Cyan
Write-Host "   Location: $Location" -ForegroundColor Cyan
Write-Host ""

# Set active subscription
Write-Host "📝 Setting active subscription..." -ForegroundColor Yellow
az account set --subscription $SubscriptionId

# Create resource group if it doesn't exist
Write-Host "📦 Creating resource group..." -ForegroundColor Yellow
az group create `
    --name $ResourceGroup `
    --location $Location `
    --tags service=ai-code-reviewer environment=prod `
    | Out-Null

# Deploy Bicep template
Write-Host "🔨 Deploying Bicep infrastructure..." -ForegroundColor Yellow
$deploymentOutput = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file ./infra/main.bicep `
    --parameters ./infra/main.parameters.json `
    --query "properties.outputs" `
    --output json

$deploymentOutput | Out-File deployment-outputs.json -Encoding utf8

# Extract outputs
Write-Host "✅ Deployment complete. Extracting outputs..." -ForegroundColor Green

$outputs = $deploymentOutput | ConvertFrom-Json
$OPENAI_ENDPOINT = $outputs.azureOpenAIEndpoint.value
$OPENAI_DEPLOYMENT = $outputs.azureOpenAIDeployment.value
$LAW_ID = $outputs.logAnalyticsWorkspaceId.value
$LAW_RESOURCE_ID = $outputs.logAnalyticsWorkspaceResourceId.value

Write-Host ""
Write-Host "📋 Deployment Outputs:" -ForegroundColor Cyan
Write-Host "   AZURE_OPENAI_ENDPOINT=$OPENAI_ENDPOINT"
Write-Host "   AZURE_OPENAI_DEPLOYMENT=$OPENAI_DEPLOYMENT"
Write-Host "   LOG_ANALYTICS_WORKSPACE_ID=$LAW_ID"
Write-Host ""

# Get API key from Azure 
Write-Host "🔑 Retrieving Azure OpenAI API key..." -ForegroundColor Yellow
$OPENAI_KEY = az cognitiveservices account keys list `
    --name aoai-code-reviewer-prod `
    --resource-group $ResourceGroup `
    --query "key1" -o tsv

Write-Host "✅ API Key retrieved (masked)" -ForegroundColor Green

# Get Log Analytics shared key
Write-Host "🔐 Retrieving Log Analytics shared key..." -ForegroundColor Yellow
try {
    $LAW_KEY = az monitor log-analytics workspace get-shared-keys `
        --name law-code-reviewer-prod `
        --resource-group $ResourceGroup `
        --query "primarySharedKey" -o tsv
    Write-Host "✅ Log Analytics shared key retrieved (masked)" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Could not retrieve Log Analytics shared key" -ForegroundColor Yellow
    $LAW_KEY = ""
}

Write-Host ""
Write-Host "📌 GitHub Repository Configuration (Set These as Secrets/Variables)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Secrets (encrypted in GitHub):" -ForegroundColor Yellow
Write-Host "  AZURE_OPENAI_ENDPOINT = $OPENAI_ENDPOINT" -ForegroundColor White
Write-Host "  AZURE_OPENAI_API_KEY = <paste key from Azure Portal>" -ForegroundColor White
Write-Host "  LOG_ANALYTICS_WORKSPACE_ID = $LAW_ID" -ForegroundColor White
Write-Host "  LOG_ANALYTICS_SHARED_KEY = <paste shared key from Azure Portal>" -ForegroundColor White
Write-Host "  BILLING_ENDPOINT = https://billing.zerononsense.dev/license" -ForegroundColor White

Write-Host ""
Write-Host "Variables (plain text in GitHub):" -ForegroundColor Yellow
Write-Host "  AZURE_OPENAI_DEPLOYMENT = $OPENAI_DEPLOYMENT" -ForegroundColor White
Write-Host "  AZURE_OPENAI_API_VERSION = 2024-10-21" -ForegroundColor White

Write-Host ""
Write-Host "📚 Next Steps:" -ForegroundColor Green
Write-Host "  1. Copy the secrets/variables above to your GitHub repo settings"
Write-Host "  2. Commit and push the test workflow"
Write-Host "  3. Create a test PR to validate the setup"
Write-Host ""
Write-Host "📖 Documentation:" -ForegroundColor Green
Write-Host "  - Setup Guide: ./docs/marketplace.md"
Write-Host "  - README: ./README.md"
