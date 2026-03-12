#!/bin/bash
# Deploy AI Code Reviewer to Azure (Production)
# Usage: ./deploy-prod.sh <subscription-id> <resource-group-name>

set -e

SUBSCRIPTION_ID="${1:-}"
RESOURCE_GROUP="${2:-rg-code-reviewer-prod}"

if [ -z "$SUBSCRIPTION_ID" ]; then
  echo "❌ Error: Subscription ID required"
  echo "Usage: $0 <subscription-id> [resource-group]"
  exit 1
fi

echo "🚀 Deploying AI Code Reviewer (Prod)"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Subscription: $SUBSCRIPTION_ID"
echo ""

# Set active subscription
echo "📝 Setting active subscription..."
az account set --subscription "$SUBSCRIPTION_ID"

# Create resource group if it doesn't exist
echo "📦 Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location westeurope \
  --tags service=ai-code-reviewer environment=prod

# Deploy Bicep template
echo "🔨 Deploying Bicep infrastructure..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file ./infra/main.bicep \
  --parameters ./infra/main.parameters.json \
  --query "properties.outputs" \
  --output json > deployment-outputs.json

# Extract outputs
echo "✅ Deployment complete. Extracting outputs..."
OPENAI_ENDPOINT=$(jq -r '.azureOpenAIEndpoint.value' deployment-outputs.json)
OPENAI_DEPLOYMENT=$(jq -r '.azureOpenAIDeployment.value' deployment-outputs.json)
LAW_ID=$(jq -r '.logAnalyticsWorkspaceId.value' deployment-outputs.json)
LAW_RESOURCE_ID=$(jq -r '.logAnalyticsWorkspaceResourceId.value' deployment-outputs.json)

echo ""
echo "📋 Deployment Outputs:"
echo "   AZURE_OPENAI_ENDPOINT=$OPENAI_ENDPOINT"
echo "   AZURE_OPENAI_DEPLOYMENT=$OPENAI_DEPLOYMENT"
echo "   LOG_ANALYTICS_WORKSPACE_ID=$LAW_ID"
echo ""

# Get API key from Azure 
echo "🔑 Retrieving Azure OpenAI API key..."
OPENAI_KEY=$(az cognitiveservices account keys list \
  --name aoai-code-reviewer-prod \
  --resource-group "$RESOURCE_GROUP" \
  --query "key1" -o tsv)

echo "✅ API Key retrieved (masked)"
echo ""

# Get Log Analytics shared key if workspace was created
echo "🔐 Retrieving Log Analytics shared key..."
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys \
  --name law-code-reviewer-prod \
  --resource-group "$RESOURCE_GROUP" \
  --query "primarySharedKey" -o tsv 2>/dev/null || echo "")

if [ -n "$LAW_KEY" ]; then
  echo "✅ Log Analytics shared key retrieved (masked)"
else
  echo "⚠️  Could not retrieve Log Analytics shared key"
fi

echo ""
echo "📌 GitHub Repository Configuration (Set These as Secrets/Variables)"
echo ""
echo "Secrets (encrypted in GitHub):"
echo "  AZURE_OPENAI_ENDPOINT = $OPENAI_ENDPOINT"
echo "  AZURE_OPENAI_API_KEY = <paste key from above>"
echo "  LOG_ANALYTICS_WORKSPACE_ID = $LAW_ID"
echo "  LOG_ANALYTICS_SHARED_KEY = <paste shared key from above>"
echo "  BILLING_ENDPOINT = https://billing.zerononsense.dev/license"
echo ""
echo "Variables (plain text in GitHub):"
echo "  AZURE_OPENAI_DEPLOYMENT = $OPENAI_DEPLOYMENT"
echo "  AZURE_OPENAI_API_VERSION = 2024-10-21"
echo ""

echo "✨ Setup complete! Next steps:"
echo "  1. Copy the secrets/variables above"
echo "  2. Add them to your GitHub repository settings"
echo "  3. Push the test workflow (.github/workflows/test-ai-reviewer.yml)"
echo "  4. Create a test PR to validate the setup"
echo ""
echo "📚 Documentation:"
echo "  - Setup Guide: ./docs/marketplace.md"
echo "  - README: ./README.md"
