// ─── Parameters ───────────────────────────────────────────────────────────────
@minLength(1)
@maxLength(64)
@description('Name for the environment (e.g. dev, prod). Used to prefix all resource names.')
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Log Analytics workspace retention in days.')
param logRetentionDays int = 30

// ─── Naming ───────────────────────────────────────────────────────────────────
var abbrs = loadJsonContent('./abbreviations.json')
var resourceSuffix = 'billingapp${toLower(environmentName)}'
var tags = { 'azd-env-name': environmentName }

// ─── Log Analytics / Application Insights ────────────────────────────────────
resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${abbrs.operationalInsightsWorkspaces}${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    retentionInDays: logRetentionDays
    sku: { name: 'PerGB2018' }
  }
}

// ─── Container Registry ───────────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: '${abbrs.containerRegistryRegistries}${resourceSuffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false  // Managed Identity used for pull – admin disabled for security
  }
}

// ─── Container Apps Environment ──────────────────────────────────────────────
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${abbrs.appManagedEnvironments}${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// ─── Managed Identity ─────────────────────────────────────────────────────────
// Single identity shared between the Container App (secretless ACR pull + KV read)
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${abbrs.managedIdentityUserAssignedIdentities}${resourceSuffix}'
  location: location
  tags: tags
}

// ACR pull role (AcrPull = 7f951dda-4ed3-4680-a7ca-43fe172d538d)
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ─── Key Vault ────────────────────────────────────────────────────────────────
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${abbrs.keyVaultVaults}${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true     // Use RBAC, not legacy access policies
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enabledForDeployment: false
    enabledForTemplateDeployment: false
    enabledForDiskEncryption: false
    publicNetworkAccess: 'Enabled'    // Container Apps (consumption) has no VNET by default
  }
}

// Key Vault Secrets User role (4633458b-17de-408a-b874-0445c86b69e6)
resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, identity.id, 'KeyVaultSecretsUser')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ─── Key Vault Secrets (placeholders – overwrite with real values after deploy) ─
// azd will inject the real values via azd env set + azd provision,
// or you can set them in the portal / az keyvault secret set.
resource secretAppId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'APP-ID'
  properties: { value: 'PLACEHOLDER' }
}

resource secretPrivateKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'PRIVATE-KEY'
  properties: { value: 'PLACEHOLDER' }
}

resource secretClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'CLIENT-ID'
  properties: { value: 'PLACEHOLDER' }
}

resource secretClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'CLIENT-SECRET'
  properties: { value: 'PLACEHOLDER' }
}

resource secretWebhookSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'WEBHOOK-SECRET'
  properties: { value: 'PLACEHOLDER' }
}

resource secretAppSlug 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'APP-SLUG'
  properties: { value: 'zero-nonsense-licenser' }
}

resource secretPlanIds 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'MARKETPLACE-PLAN-IDS'
  properties: { value: 'PLACEHOLDER' }
}

// ─── Container App ────────────────────────────────────────────────────────────
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${abbrs.appContainerApps}${resourceSuffix}'
  location: location
  tags: union(tags, { 'azd-service-name': 'billing-app' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        // Allow scale-down to 0 replicas while ensuring at most 1 instance during cold start
        // to avoid webhook duplicate processing
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      // Secrets reference Key Vault directly – no secret values stored in ARM template
      secrets: [
        {
          name: 'app-id'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/APP-ID'
          identity: identity.id
        }
        {
          name: 'private-key'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/PRIVATE-KEY'
          identity: identity.id
        }
        {
          name: 'client-id'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/CLIENT-ID'
          identity: identity.id
        }
        {
          name: 'client-secret'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/CLIENT-SECRET'
          identity: identity.id
        }
        {
          name: 'webhook-secret'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/WEBHOOK-SECRET'
          identity: identity.id
        }
        {
          name: 'app-slug'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/APP-SLUG'
          identity: identity.id
        }
        {
          name: 'marketplace-plan-ids'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/MARKETPLACE-PLAN-IDS'
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'billing-app'
          image: '${acr.properties.loginServer}/billing-app:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'APP_ID',                secretRef: 'app-id' }
            { name: 'PRIVATE_KEY',           secretRef: 'private-key' }
            { name: 'CLIENT_ID',             secretRef: 'client-id' }
            { name: 'CLIENT_SECRET',         secretRef: 'client-secret' }
            { name: 'WEBHOOK_SECRET',        secretRef: 'webhook-secret' }
            { name: 'APP_SLUG',              secretRef: 'app-slug' }
            { name: 'MARKETPLACE_PLAN_IDS',  secretRef: 'marketplace-plan-ids' }
            { name: 'PORT',                  value: '3000' }
            { name: 'NODE_ENV',              value: 'production' }
          ]
        }
      ]
      scale: {
        minReplicas: 0   // Scales to 0 when idle → lowest cost
        maxReplicas: 1   // Single instance avoids duplicate webhook processing
      }
    }
  }
}

// ─── Outputs (consumed by azure.yaml and azd) ─────────────────────────────────
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.properties.loginServer
output AZURE_KEY_VAULT_NAME string = kv.name
output CONTAINER_APP_FQDN string = containerApp.properties.configuration.ingress.fqdn
output MANAGED_IDENTITY_CLIENT_ID string = identity.properties.clientId
