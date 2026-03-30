# =============================================================================
# databricks.tf - Databricks workspace with VNet injection
# =============================================================================
# Creates a Premium Databricks workspace injected into the data plane VNet
# (public and private subnets). Root storage (DBFS) uses the derived storage
# account name. Public network access is always enabled (no front-end Private Link).
# Managed resource group named mrg-<workspace_name>.
# =============================================================================

# =============================================================================
# Admin access and service principal workspace permissions
# =============================================================================

data "databricks_user" "workspace_access" {
  provider  = databricks.account
  user_name = var.admin_user
}

resource "databricks_mws_permission_assignment" "workspace_access" {
  provider     = databricks.account
  workspace_id = azurerm_databricks_workspace.dp_workspace.workspace_id
  principal_id = data.databricks_user.workspace_access.id
  permissions  = ["ADMIN"]
  depends_on   = [time_sleep.wait_for_identity_federation]
}

data "databricks_service_principal" "deployer" {
  count          = var.databricks_auth_type == "oauth-m2m" ? 1 : 0
  provider       = databricks.account
  application_id = var.databricks_client_id
}

resource "databricks_mws_permission_assignment" "sp_workspace_access" {
  count        = var.databricks_auth_type == "oauth-m2m" ? 1 : 0
  provider     = databricks.account
  workspace_id = azurerm_databricks_workspace.dp_workspace.workspace_id
  principal_id = data.databricks_service_principal.deployer[0].id
  permissions  = ["ADMIN"]
  depends_on   = [time_sleep.wait_for_identity_federation]
}

# =============================================================================
# Metastore detection, creation, and assignment
# =============================================================================

resource "random_string" "metastore_suffix" {
  length  = 8
  special = false
  upper   = false
}

data "databricks_metastores" "all" {
  count    = var.existing_metastore_id == "" ? 1 : 0
  provider = databricks.account
}

locals {
  auto_metastore_name = "metastore-${var.location}-${random_string.metastore_suffix.result}"

  existing_metastore_ids = var.existing_metastore_id != "" ? [] : [
    for name, id in data.databricks_metastores.all[0].ids : id
    if can(regex(".*${var.location}.*", lower(name)))
  ]

  found_existing_metastore   = length(local.existing_metastore_ids) > 0
  use_existing_metastore     = var.existing_metastore_id != "" || local.found_existing_metastore
  create_metastore_resources = !local.use_existing_metastore

  metastore_id_to_use = var.existing_metastore_id != "" ? var.existing_metastore_id : (
    local.found_existing_metastore ? local.existing_metastore_ids[0] : (
      length(databricks_metastore.this) > 0 ? databricks_metastore.this[0].id : ""
    )
  )
}

resource "databricks_metastore" "this" {
  count      = local.create_metastore_resources ? 1 : 0
  provider   = databricks.account
  name       = local.auto_metastore_name
  region     = var.location
  owner      = "${local.auto_metastore_name}-admins"
  depends_on = [databricks_group.metastore_owner_group]

  lifecycle {
    ignore_changes = [name]
  }
}

resource "databricks_group" "metastore_owner_group" {
  count        = local.create_metastore_resources ? 1 : 0
  provider     = databricks.account
  display_name = "${local.auto_metastore_name}-admins"
}

data "databricks_user" "metastore_owner" {
  count     = local.create_metastore_resources ? 1 : 0
  provider  = databricks.account
  user_name = var.admin_user
}

resource "databricks_group_member" "metastore_owner" {
  count     = local.create_metastore_resources ? 1 : 0
  provider  = databricks.account
  group_id  = databricks_group.metastore_owner_group[0].id
  member_id = data.databricks_user.metastore_owner[0].id
}

resource "databricks_metastore_assignment" "this" {
  provider     = databricks.account
  workspace_id = azurerm_databricks_workspace.dp_workspace.workspace_id
  metastore_id = local.metastore_id_to_use
}

resource "time_sleep" "wait_for_identity_federation" {
  depends_on      = [databricks_metastore_assignment.this]
  create_duration = "120s"
}

# =============================================================================
# Databricks workspace
# =============================================================================

resource "azurerm_databricks_workspace" "dp_workspace" {
  name                           = var.prefix
  resource_group_name            = local.dp_rg_name
  location                       = local.dp_rg_location
  sku                            = "premium"
  tags                           = local.tags
  public_network_access_enabled  = true
  network_security_group_rules_required = "NoAzureDatabricksRules"
  customer_managed_key_enabled   = true
  # Named MRG (e.g. mrg-dbw-ts-privatelink-test-dp). Changing this forces workspace replacement.
  managed_resource_group_name    = "mrg-${var.prefix}"

  # VNet injection: use dp_public and dp_private subnets and their NSG associations.
  # storage_account_name is the workspace root (DBFS) storage; must be unique and alphanumeric.
  custom_parameters {
    virtual_network_id                                   = azurerm_virtual_network.dp_vnet.id
    private_subnet_name                                  = azurerm_subnet.dp_private.name
    public_subnet_name                                   = azurerm_subnet.dp_public.name
    public_subnet_network_security_group_association_id  = azurerm_subnet_network_security_group_association.dp_public.id
    private_subnet_network_security_group_association_id = azurerm_subnet_network_security_group_association.dp_private.id
    storage_account_name                                 = local.dbfsname
  }

  depends_on = [
    azurerm_subnet_network_security_group_association.dp_public,
    azurerm_subnet_network_security_group_association.dp_private,
    databricks_mws_network_connectivity_config.ncc
  ]
}

