# Azure credentials via environment variables (ARM_TENANT_ID, ARM_SUBSCRIPTION_ID, etc.)
# or Azure CLI authentication
provider "azurerm" {
  subscription_id = var.azure_subscription_id
  tenant_id = var.tenant_id
  features {}
}

# Databricks workspace provider
# - "databricks-cli" - Uses Databricks CLI profile authentication
# - "azure-cli" - Uses Azure CLI OAuth authentication
# - "oauth-m2m" - Uses service principal credentials
provider "databricks" {
  host       = var.workspace_url_override != "" ? var.workspace_url_override : azurerm_databricks_workspace.this.workspace_url
  auth_type  = var.databricks_auth_type
  # For oauth-m2m only
  client_id     = var.databricks_auth_type == "oauth-m2m" ? var.databricks_client_id : null
  client_secret = var.databricks_auth_type == "oauth-m2m" ? var.databricks_client_secret : null
}

# Databricks account provider
# - "databricks-cli" - Uses Databricks CLI profile authentication
# - "azure-cli" - Uses Azure CLI OAuth authentication  
# - "oauth-m2m" - Uses service principal credentials
provider "databricks" {
  alias      = "accounts"
  host       = "https://accounts.azuredatabricks.net"
  account_id = var.databricks_account_id
  auth_type  = var.databricks_auth_type
  # For oauth-m2m only
  client_id     = var.databricks_auth_type == "oauth-m2m" ? var.databricks_client_id : null
  client_secret = var.databricks_auth_type == "oauth-m2m" ? var.databricks_client_secret : null
  # For databricks-cli only
  profile = var.databricks_auth_type == "databricks-cli" ? var.databricks_profile : null
}