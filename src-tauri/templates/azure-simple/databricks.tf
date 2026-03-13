resource "azurerm_databricks_workspace" "this" {
  name                        = var.workspace_name
  resource_group_name         = local.resource_group.name
  location                    = local.resource_group.location
  sku                         = var.workspace_sku
  tags                        = var.tags
  # Use a unique managed resource group name to avoid conflicts with orphaned resources
  managed_resource_group_name = "${var.workspace_name}-managed-rg"

  custom_parameters {
    virtual_network_id                                   = local.vnet.id
    private_subnet_name                                  = azurerm_subnet.private.name
    public_subnet_name                                   = azurerm_subnet.public.name
    public_subnet_network_security_group_association_id  = azurerm_subnet_network_security_group_association.public.id
    private_subnet_network_security_group_association_id = azurerm_subnet_network_security_group_association.private.id
    storage_account_name                                 = var.root_storage_name
    no_public_ip                                         = true
  }

  depends_on = [
    azurerm_subnet_network_security_group_association.public,
    azurerm_subnet_network_security_group_association.private
  ]
}

# assign admin access to the workspace

data "databricks_user" "workspace_access" {
  provider = databricks.accounts
  user_name = var.admin_user
}

resource "databricks_mws_permission_assignment" "workspace_access" {
  provider = databricks.accounts
  workspace_id = azurerm_databricks_workspace.this.workspace_id
  principal_id = data.databricks_user.workspace_access.id
  permissions  = ["ADMIN"]
  depends_on = [
    time_sleep.wait_for_identity_federation
  ]
}

# Add Databricks SP to workspace (required for SP auth to work at workspace level)
# Only needed when using oauth-m2m authentication
data "databricks_service_principal" "deployer" {
  count          = var.databricks_auth_type == "oauth-m2m" ? 1 : 0
  provider       = databricks.accounts
  application_id = var.databricks_client_id
}

resource "databricks_mws_permission_assignment" "sp_workspace_access" {
  count        = var.databricks_auth_type == "oauth-m2m" ? 1 : 0
  provider     = databricks.accounts
  workspace_id = azurerm_databricks_workspace.this.workspace_id
  principal_id = data.databricks_service_principal.deployer[0].id
  permissions  = ["ADMIN"]
  depends_on = [
    time_sleep.wait_for_identity_federation
  ]
}

# Metastore configuration
# Automatically detects existing metastore in the region or creates a new one
# If existing_metastore_id is explicitly provided, uses that instead

# Random suffix for metastore name
resource "random_string" "metastore_suffix" {
  length  = 8
  special = false
  upper   = false
}

# Get list of all metastores in the account (skip if user already provided a metastore ID,
# because the provider crashes on duplicate metastore names)
data "databricks_metastores" "all" {
  count    = var.existing_metastore_id == "" ? 1 : 0
  provider = databricks.accounts
}

locals {
  # Auto-generated metastore name: metastore-{region}-{randomsuffix}
  auto_metastore_name = "metastore-${var.location}-${random_string.metastore_suffix.result}"
  
  # Find existing metastore for this region (Azure location)
  existing_metastore_ids = var.existing_metastore_id != "" ? [] : [
    for name, id in data.databricks_metastores.all[0].ids : id
    if can(regex(".*${var.location}.*", lower(name)))
  ]
  
  # Check if we found an existing metastore for this region
  found_existing_metastore = length(local.existing_metastore_ids) > 0
  
  # Determine if we should use an existing metastore (user-provided or auto-detected)
  use_existing_metastore = var.existing_metastore_id != "" || local.found_existing_metastore
  
  # Determine if we need to create metastore owner resources
  create_metastore_resources = !local.use_existing_metastore
  
  # The metastore ID to use for assignment
  metastore_id_to_use = var.existing_metastore_id != "" ? var.existing_metastore_id : (
    local.found_existing_metastore ? local.existing_metastore_ids[0] : (
      length(databricks_metastore.this) > 0 ? databricks_metastore.this[0].id : ""
    )
  )
}

# Create metastore only if no existing one found and user didn't provide one
resource "databricks_metastore" "this" {
  count         = local.create_metastore_resources ? 1 : 0
  provider      = databricks.accounts
  name          = local.auto_metastore_name
  region        = var.location
  owner         = "${local.auto_metastore_name}-admins"
  depends_on    = [databricks_group.metastore_owner_group]
  
  lifecycle {
    ignore_changes = [name]
  }
}

resource "databricks_group" "metastore_owner_group" {
  count        = local.create_metastore_resources ? 1 : 0
  provider     = databricks.accounts
  display_name = "${local.auto_metastore_name}-admins"
}

data "databricks_user" "metastore_owner" {
  count     = local.create_metastore_resources ? 1 : 0
  provider  = databricks.accounts
  user_name = var.admin_user
}

resource "databricks_group_member" "metastore_owner" {
  count     = local.create_metastore_resources ? 1 : 0
  provider  = databricks.accounts
  group_id  = databricks_group.metastore_owner_group[0].id
  member_id = data.databricks_user.metastore_owner[0].id
}

resource "databricks_metastore_assignment" "this" {
  provider     = databricks.accounts
  workspace_id = azurerm_databricks_workspace.this.workspace_id
  metastore_id = local.metastore_id_to_use
}

# Wait for Azure identity federation to propagate after metastore assignment
# This enables the MWS permission assignment APIs (typically takes 1-2 minutes)
resource "time_sleep" "wait_for_identity_federation" {
  depends_on = [databricks_metastore_assignment.this]
  
  create_duration = "120s"
}