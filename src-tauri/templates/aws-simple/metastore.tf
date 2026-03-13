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
  provider = databricks.mws
}

# Find existing metastore for this region
locals {
  # Auto-generated metastore name: metastore-{region}-{randomsuffix}
  auto_metastore_name = "metastore-${var.region}-${random_string.metastore_suffix.result}"
  
  # If user provided an existing_metastore_id, use it
  # Otherwise, look for an existing metastore in this region
  existing_metastore_ids = var.existing_metastore_id != "" ? [] : [
    for name, id in data.databricks_metastores.all[0].ids : id
    if can(regex(".*${var.region}.*", lower(name)))
  ]
  
  # Check if we found an existing metastore for this region
  found_existing_metastore = length(local.existing_metastore_ids) > 0
  
  # Determine which metastore to use:
  # 1. User-provided existing_metastore_id (highest priority)
  # 2. First existing metastore found in the region
  # 3. Create a new one if none exist
  use_existing_metastore = var.existing_metastore_id != "" || local.found_existing_metastore
  
  # The metastore ID to use for assignment
  metastore_id_to_use = var.existing_metastore_id != "" ? var.existing_metastore_id : (
    local.found_existing_metastore ? local.existing_metastore_ids[0] : (
      length(databricks_metastore.this) > 0 ? databricks_metastore.this[0].id : ""
    )
  )
}

# Create metastore only if no existing one found and user didn't provide one
resource "databricks_metastore" "this" {
  count         = local.use_existing_metastore ? 0 : 1
  provider      = databricks.mws
  name          = local.auto_metastore_name
  region        = var.region
  force_destroy = true
  
  lifecycle {
    ignore_changes = [name]
  }
}

# Assign metastore to workspace
resource "databricks_metastore_assignment" "this" {
  provider     = databricks.mws
  metastore_id = local.metastore_id_to_use
  workspace_id = databricks_mws_workspaces.this.workspace_id
  depends_on   = [databricks_mws_workspaces.this]
}
