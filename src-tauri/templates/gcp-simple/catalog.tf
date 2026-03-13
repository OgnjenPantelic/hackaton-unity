# Unity Catalog with Isolated GCS Storage
# Creates a catalog with dedicated GCS bucket, storage credential, and external location
# This provides workspace-isolated data storage (recommended)

# Only create resources if Unity Catalog is enabled
locals {
  create_uc = var.create_unity_catalog && var.uc_catalog_name != "" && var.uc_storage_name != ""
  
  # Sanitize catalog name for GCP resources (replace underscores with hyphens, lowercase)
  uc_catalog_name_sanitized = local.create_uc ? lower(replace(var.uc_catalog_name, "_", "-")) : ""
}

# GCS bucket for catalog data
resource "google_storage_bucket" "uc_catalog" {
  count = local.create_uc ? 1 : 0
  
  name     = var.uc_storage_name
  location = var.google_region
  
  # Required for Unity Catalog - uniform bucket-level access
  uniform_bucket_level_access = true
  
  # Force destroy allows terraform destroy to delete non-empty buckets
  force_destroy = var.uc_force_destroy
  
  labels = merge(var.tags, {
    purpose = "unity-catalog-storage"
    catalog = local.uc_catalog_name_sanitized
  })
}

# Storage Credential using Databricks-managed GCP service account
# This creates a service account managed by Databricks for accessing the GCS bucket
resource "databricks_storage_credential" "uc_credential" {
  provider = databricks.workspace
  count    = local.create_uc ? 1 : 0
  
  name = "${local.uc_catalog_name_sanitized}-storage-credential"
  
  # Use Databricks-managed GCP service account
  # This automatically creates a service account in the Databricks-managed project
  databricks_gcp_service_account {}
  
  comment = "Storage credential for ${var.uc_catalog_name} catalog - managed by Terraform"
  
  depends_on = [
    databricks_metastore_assignment.this
  ]
}

# Wait for the Databricks-managed service account to propagate in GCP
# This prevents "service account does not exist" errors when applying IAM bindings
resource "time_sleep" "wait_for_credential_propagation" {
  count = local.create_uc ? 1 : 0
  
  depends_on = [databricks_storage_credential.uc_credential]
  
  create_duration = "30s"
}

# Grant the Databricks-managed service account access to the GCS bucket
# Requires both objectAdmin (for objects) and legacyBucketReader (for bucket metadata)
resource "google_storage_bucket_iam_member" "uc_credential_access" {
  count = local.create_uc ? 1 : 0
  
  bucket = google_storage_bucket.uc_catalog[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${databricks_storage_credential.uc_credential[0].databricks_gcp_service_account[0].email}"
  
  depends_on = [
    time_sleep.wait_for_credential_propagation
  ]
}

# Grant bucket-level read access (required for storage.buckets.get permission)
resource "google_storage_bucket_iam_member" "uc_credential_bucket_reader" {
  count = local.create_uc ? 1 : 0
  
  bucket = google_storage_bucket.uc_catalog[0].name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${databricks_storage_credential.uc_credential[0].databricks_gcp_service_account[0].email}"
  
  depends_on = [
    time_sleep.wait_for_credential_propagation
  ]
}

# External Location pointing to the GCS bucket
resource "databricks_external_location" "uc_location" {
  provider = databricks.workspace
  count    = local.create_uc ? 1 : 0
  
  name            = "${local.uc_catalog_name_sanitized}-location"
  url             = "gs://${google_storage_bucket.uc_catalog[0].name}"
  credential_name = databricks_storage_credential.uc_credential[0].name
  comment         = "External location for ${var.uc_catalog_name} catalog - managed by Terraform"
  force_destroy   = var.uc_force_destroy
  
  depends_on = [
    google_storage_bucket_iam_member.uc_credential_access,
    google_storage_bucket_iam_member.uc_credential_bucket_reader
  ]
}

# Unity Catalog
resource "databricks_catalog" "uc_catalog" {
  provider = databricks.workspace
  count    = local.create_uc ? 1 : 0
  
  name         = var.uc_catalog_name
  storage_root = "gs://${google_storage_bucket.uc_catalog[0].name}"
  comment      = "Catalog with isolated GCS storage - managed by Terraform"
  force_destroy = var.uc_force_destroy
  
  depends_on = [databricks_external_location.uc_location]
}

# Grant catalog ownership to admin user
resource "databricks_grant" "uc_catalog_owner" {
  provider = databricks.workspace
  count    = local.create_uc ? 1 : 0
  
  catalog    = databricks_catalog.uc_catalog[0].name
  principal  = var.admin_user
  privileges = ["ALL_PRIVILEGES"]
}
