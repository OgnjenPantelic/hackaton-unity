######################################################
# Databricks BYO VPC Network Configuration
######################################################
resource "databricks_mws_networks" "databricks_network" {
  provider     = databricks.accounts
  account_id   = var.databricks_account_id
  network_name = "dbx-nwt-${random_string.databricks_suffix.result}"

  gcp_network_info {
    network_project_id = var.google_project_name
    vpc_id             = google_compute_network.databricks_vpc.name
    subnet_id          = google_compute_subnetwork.databricks_subnet.name
    subnet_region      = var.google_region
  }
}

######################################################
# Databricks Workspace
######################################################
resource "databricks_mws_workspaces" "databricks_workspace" {
  provider       = databricks.accounts
  account_id     = var.databricks_account_id
  workspace_name = var.databricks_workspace_name
  location       = var.google_region

  cloud_resource_container {
    gcp {
      project_id = var.google_project_name
    }
  }

  network_id = databricks_mws_networks.databricks_network.network_id
}

######################################################
# Admin User Configuration
######################################################

# Get admin user from account level
data "databricks_user" "workspace_access" {
  provider  = databricks.accounts
  user_name = var.admin_user
}

# Assign admin access to the workspace
resource "databricks_mws_permission_assignment" "workspace_access" {
  provider     = databricks.accounts
  workspace_id = databricks_mws_workspaces.databricks_workspace.workspace_id
  principal_id = data.databricks_user.workspace_access.id
  permissions  = ["ADMIN"]
  depends_on   = [databricks_metastore_assignment.this]
}

######################################################
# Unity Catalog Metastore Configuration
# Automatically detects existing metastore in the region or creates a new one
# If existing_metastore_id is explicitly provided, uses that instead
######################################################

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
  # Auto-generated metastore name: metastore-${var.google_region}-${random_string.metastore_suffix.result}
  auto_metastore_name = "metastore-${var.google_region}-${random_string.metastore_suffix.result}"
  
  # Find existing metastore for this region (GCP region)
  existing_metastore_ids = var.existing_metastore_id != "" ? [] : [
    for name, id in data.databricks_metastores.all[0].ids : id
    if can(regex(".*${var.google_region}.*", lower(name)))
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

# Create metastore owner group only if creating new metastore
resource "databricks_group" "metastore_owner_group" {
  count        = local.create_metastore_resources ? 1 : 0
  provider     = databricks.accounts
  display_name = "${local.auto_metastore_name}-admins"
}

# Get admin user for metastore ownership
data "databricks_user" "metastore_owner" {
  count     = local.create_metastore_resources ? 1 : 0
  provider  = databricks.accounts
  user_name = var.admin_user
}

# Add admin user to metastore owner group
resource "databricks_group_member" "metastore_owner" {
  count     = local.create_metastore_resources ? 1 : 0
  provider  = databricks.accounts
  group_id  = databricks_group.metastore_owner_group[0].id
  member_id = data.databricks_user.metastore_owner[0].id
}

# Create metastore only if no existing one found and user didn't provide one
resource "databricks_metastore" "this" {
  count      = local.create_metastore_resources ? 1 : 0
  provider   = databricks.accounts
  name       = local.auto_metastore_name
  region     = var.google_region
  owner      = "${local.auto_metastore_name}-admins"
  depends_on = [databricks_group.metastore_owner_group]
  
  lifecycle {
    ignore_changes = [name]
  }
}

# Assign metastore to workspace
# Note: Do NOT set default_catalog_name here - it can cause conflicts with catalog creation
resource "databricks_metastore_assignment" "this" {
  provider     = databricks.accounts
  workspace_id = databricks_mws_workspaces.databricks_workspace.workspace_id
  metastore_id = local.metastore_id_to_use
}

