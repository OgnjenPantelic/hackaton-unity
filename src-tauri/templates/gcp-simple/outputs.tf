######################################################
# Outputs
######################################################

output "workspace_url" {
  description = "URL of the Databricks workspace"
  value       = databricks_mws_workspaces.databricks_workspace.workspace_url
}

output "workspace_id" {
  description = "ID of the Databricks workspace"
  value       = databricks_mws_workspaces.databricks_workspace.workspace_id
}

output "gcp_project" {
  description = "GCP project ID"
  value       = var.google_project_name
}

output "gcp_region" {
  description = "GCP region"
  value       = var.google_region
}

output "vpc_name" {
  description = "Name of the VPC created for Databricks"
  value       = google_compute_network.databricks_vpc.name
}

output "subnet_name" {
  description = "Name of the subnet created for Databricks"
  value       = google_compute_subnetwork.databricks_subnet.name
}

# Metastore outputs
output "metastore_id" {
  description = "ID of the Unity Catalog metastore (auto-detected or created)"
  value       = local.metastore_id_to_use
}

output "metastore_created" {
  description = "Whether a new metastore was created"
  value       = local.create_metastore_resources
}

# Unity Catalog outputs (only if created)
output "catalog_name" {
  description = "Name of the Unity Catalog (if created)"
  value       = local.create_uc ? var.uc_catalog_name : null
}

output "catalog_storage_bucket" {
  description = "GCS bucket for catalog storage (if created)"
  value       = local.create_uc ? google_storage_bucket.uc_catalog[0].name : null
}

