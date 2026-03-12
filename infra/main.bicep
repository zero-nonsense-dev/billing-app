targetScope = 'resourceGroup'

@description('Environment name used as a prefix for resource names')
param environmentName string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Name of the Azure OpenAI account')
param openAIAccountName string

@description('Name of the Azure OpenAI model deployment')
param openAIDeploymentName string

@description('Model name for deployment')
param openAIModelName string = 'gpt-4o-mini'

@description('Model version for deployment')
param openAIModelVersion string = '2024-07-18'

@description('Model format, usually OpenAI')
param openAIModelFormat string = 'OpenAI'

@description('Log Analytics workspace name for audit logs')
param logAnalyticsWorkspaceName string

resource openAI 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAIAccountName
  location: location
  kind: 'OpenAI'
  tags: {
    environment: environmentName
    service: 'ai-code-reviewer'
  }
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: toLower(openAIAccountName)
    publicNetworkAccess: 'Enabled'
  }
}

resource openAIDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAI
  name: openAIDeploymentName
  sku: {
    name: 'Standard'
    capacity: 10
  }
  properties: {
    model: {
      format: openAIModelFormat
      name: openAIModelName
      version: openAIModelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: {
    environment: environmentName
    service: 'ai-code-reviewer'
  }
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

output azureOpenAIEndpoint string = 'https://${openAI.name}.openai.azure.com'
output azureOpenAIDeployment string = openAIDeployment.name
output logAnalyticsWorkspaceId string = law.properties.customerId
output logAnalyticsWorkspaceResourceId string = law.id
