# =============================================================================
# providers.tf - Azure and Databricks provider configuration
# =============================================================================
# Azure RM: subscription via var.az_subscription; auth via Azure CLI or ARM_* env.
# Databricks account: for NCC (serverless private endpoints); requires account_id
# and Azure auth (same tenant). See variables for databricks_account_id.
# =============================================================================

# Authenticate using Azure CLI: https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli
# Run `az login` for interactive login, or use environment variables for service principal:
# export ARM_CLIENT_ID=CLIENT_ID
# export ARM_CLIENT_SECRET=CLIENT_SECRET
# export ARM_TENANT_ID=TENANT_ID
# export ARM_SUBSCRIPTION_ID=SUBSCRIPTION_ID

provider "azurerm" {
  features {}
  subscription_id = var.az_subscription
}

provider "azapi" {
}

# Workspace-level provider for catalog, storage credentials, grants, etc.
# Auth: azure-cli (Azure CLI / managed identity) or oauth-m2m (Databricks service principal).
provider "databricks" {
  host       = "https://${azurerm_databricks_workspace.dp_workspace.workspace_url}"
  auth_type  = var.databricks_auth_type
  client_id     = var.databricks_auth_type == "oauth-m2m" ? var.databricks_client_id : null
  client_secret = var.databricks_auth_type == "oauth-m2m" ? var.databricks_client_secret : null
}

# Account-level provider for NCC, metastore operations, and workspace permission assignments.
# Auth: Azure CLI (az login) or Azure service principal (ARM_* or DATABRICKS_AZURE_*).
provider "databricks" {
  alias            = "account"
  host             = "https://accounts.azuredatabricks.net"
  account_id       = var.databricks_account_id
  azure_tenant_id  = data.azurerm_client_config.current.tenant_id
}
