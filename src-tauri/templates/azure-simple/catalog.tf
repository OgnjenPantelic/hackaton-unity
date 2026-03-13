# Unity Catalog with Isolated Storage
# Creates a catalog with dedicated Azure Storage Account, Access Connector, storage credential, and external location
# This provides workspace-isolated data storage (recommended)

# Only create resources if Unity Catalog is enabled
locals {
  create_uc = var.create_unity_catalog && var.uc_catalog_name != "" && var.uc_storage_name != ""
  
  # Sanitize catalog name for Azure resources (replace underscores with hyphens, lowercase)
  uc_catalog_name_sanitized = local.create_uc ? lower(replace(var.uc_catalog_name, "_", "-")) : ""
  
  # Container name for catalog data (Azure only allows lowercase alphanumeric and hyphens)
  uc_container_name = local.create_uc ? "${local.uc_catalog_name_sanitized}-data" : ""
  
  # Access connector name
  uc_access_connector_name = local.create_uc ? "${local.uc_catalog_name_sanitized}-access-connector" : ""
}

# Azure Storage Account for catalog data
resource "azurerm_storage_account" "uc_catalog" {
  count = local.create_uc ? 1 : 0
  
  name                     = var.uc_storage_name
  resource_group_name      = local.resource_group.name
  location                 = local.resource_group.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  is_hns_enabled           = true  # Required for Unity Catalog (hierarchical namespace)
  
  tags = merge(var.tags, {
    Name    = "${local.uc_catalog_name_sanitized}-catalog-storage"
    Purpose = "Unity Catalog Storage"
  })
}

# Storage Container for catalog data
resource "azurerm_storage_container" "uc_catalog" {
  count = local.create_uc ? 1 : 0
  
  name                 = local.uc_container_name
  storage_account_id   = azurerm_storage_account.uc_catalog[0].id
  container_access_type = "private"
}

# Databricks Access Connector (Managed Identity)
resource "azurerm_databricks_access_connector" "uc_connector" {
  count = local.create_uc ? 1 : 0
  
  name                = local.uc_access_connector_name
  resource_group_name = local.resource_group.name
  location            = local.resource_group.location
  
  identity {
    type = "SystemAssigned"
  }
  
  tags = merge(var.tags, {
    Name    = local.uc_access_connector_name
    Purpose = "Unity Catalog Access"
  })
}

# Grant Storage Blob Data Contributor role to Access Connector
resource "azurerm_role_assignment" "uc_storage_access" {
  count = local.create_uc ? 1 : 0
  
  scope                = azurerm_storage_account.uc_catalog[0].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_databricks_access_connector.uc_connector[0].identity[0].principal_id
}

# Storage Credential using Managed Identity
resource "databricks_storage_credential" "uc_credential" {
  count = local.create_uc ? 1 : 0
  
  name = "${local.uc_catalog_name_sanitized}-storage-credential"
  
  azure_managed_identity {
    access_connector_id = azurerm_databricks_access_connector.uc_connector[0].id
  }
  
  comment = "Storage credential for ${var.uc_catalog_name} catalog - managed by Terraform"
  
  depends_on = [
    databricks_metastore_assignment.this,
    azurerm_role_assignment.uc_storage_access,
    # Ensure SP is added to workspace before workspace-level operations (for SP auth)
    databricks_mws_permission_assignment.sp_workspace_access
  ]
}

# External Location
resource "databricks_external_location" "uc_location" {
  count = local.create_uc ? 1 : 0
  
  name = "${local.uc_catalog_name_sanitized}-location"
  url = format(
    "abfss://%s@%s.dfs.core.windows.net",
    azurerm_storage_container.uc_catalog[0].name,
    azurerm_storage_account.uc_catalog[0].name
  )
  credential_name = databricks_storage_credential.uc_credential[0].name
  comment         = "External location for ${var.uc_catalog_name} catalog - managed by Terraform"
  force_destroy   = var.uc_force_destroy
  
  depends_on = [
    databricks_storage_credential.uc_credential,
    azurerm_role_assignment.uc_storage_access
  ]
}

# Unity Catalog
resource "databricks_catalog" "uc_catalog" {
  count = local.create_uc ? 1 : 0
  
  name = var.uc_catalog_name
  storage_root = format(
    "abfss://%s@%s.dfs.core.windows.net",
    azurerm_storage_container.uc_catalog[0].name,
    azurerm_storage_account.uc_catalog[0].name
  )
  comment       = "Catalog with isolated storage - managed by Terraform"
  force_destroy = var.uc_force_destroy
  
  depends_on = [databricks_external_location.uc_location]
}

# Grant catalog ownership to admin user
resource "databricks_grant" "uc_catalog_owner" {
  count = local.create_uc ? 1 : 0
  
  catalog   = databricks_catalog.uc_catalog[0].name
  principal = var.admin_user
  privileges = ["ALL_PRIVILEGES"]
}
