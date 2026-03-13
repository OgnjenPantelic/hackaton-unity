# =============================================================================
# Authentication Configuration
# =============================================================================

variable "gcp_auth_method" {
  description = "GCP authentication method: 'impersonation' (SA email + gcloud token) or 'credentials' (SA JSON key)"
  type        = string
  default     = "impersonation"
  validation {
    condition     = contains(["impersonation", "credentials"], var.gcp_auth_method)
    error_message = "gcp_auth_method must be 'impersonation' or 'credentials'"
  }
}

# =============================================================================
# GCP Configuration
# =============================================================================

variable "google_service_account_email" {
  description = "Email of the Google Service Account (required when gcp_auth_method='impersonation', must have Owner role and be added to Databricks account)"
  type        = string
  default     = ""
}

variable "google_credentials_json" {
  description = "Google service account JSON key content (required when gcp_auth_method='credentials')"
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_project_name" {
  description = "GCP project ID where resources will be created"
  type        = string
}

variable "google_region" {
  description = "GCP region for resources (e.g., us-central1)"
  type        = string
  validation {
    condition = contains([
      "us-central1", "us-east1", "us-east4", "us-west1", "us-west2", "us-west3", "us-west4",
      "northamerica-northeast1", "northamerica-northeast2",
      "southamerica-east1", "southamerica-west1",
      "europe-west1", "europe-west2", "europe-west3", "europe-west4", "europe-west6", "europe-west9",
      "europe-north1", "europe-central2",
      "asia-east1", "asia-east2", "asia-northeast1", "asia-northeast2", "asia-northeast3",
      "asia-south1", "asia-south2", "asia-southeast1", "asia-southeast2",
      "australia-southeast1", "australia-southeast2"
    ], var.google_region)
    error_message = "Valid values for var.google_region are standard GCP regions supported by Databricks."
  }
}

variable "tags" {
  description = "A map of labels to assign to GCP resources"
  type        = map(string)
  default     = {}
}

# =============================================================================
# Databricks Configuration
# =============================================================================

variable "databricks_account_id" {
  description = "Databricks Account ID"
  type        = string
}

variable "databricks_workspace_name" {
  description = "Name for the Databricks workspace"
  type        = string
}

variable "admin_user" {
  description = "Admin user email to add to the workspace (must exist at Account level)"
  type        = string
  validation {
    condition     = can(regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", var.admin_user))
    error_message = "admin_user must be a valid email address"
  }
}

variable "existing_metastore_id" {
  description = "The ID of an existing metastore to use. Leave empty to auto-detect or create a new one."
  type        = string
  default     = ""
}

# =============================================================================
# Network Configuration
# =============================================================================

variable "subnet_cidr" {
  description = "CIDR block for the Databricks subnet (e.g., 10.0.0.0/16)"
  type        = string
  default     = "10.0.0.0/16"
}

# =============================================================================
# Unity Catalog Configuration
# =============================================================================

variable "create_unity_catalog" {
  description = "Whether to create a Unity Catalog with isolated GCS storage"
  type        = bool
  default     = false
}

variable "uc_catalog_name" {
  description = "Name for the Unity Catalog (lowercase, underscores allowed)"
  type        = string
  default     = ""
}

variable "uc_storage_name" {
  description = "GCS bucket name for catalog storage (must be globally unique, 3-63 chars, lowercase letters, numbers, hyphens)"
  type        = string
  default     = ""
  validation {
    condition     = var.uc_storage_name == "" || (length(var.uc_storage_name) >= 3 && length(var.uc_storage_name) <= 63)
    error_message = "uc_storage_name must be between 3 and 63 characters when provided."
  }
  validation {
    condition     = var.uc_storage_name == "" || can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", var.uc_storage_name)) || (length(var.uc_storage_name) >= 3 && length(var.uc_storage_name) <= 63 && can(regex("^[a-z0-9]+$", var.uc_storage_name)))
    error_message = "uc_storage_name can only contain lowercase letters, numbers, and hyphens. Must start and end with a letter or number."
  }
}

variable "uc_force_destroy" {
  description = "Whether to force destroy the catalog storage on terraform destroy (safe for newly created catalogs)"
  type        = bool
  default     = true
}

