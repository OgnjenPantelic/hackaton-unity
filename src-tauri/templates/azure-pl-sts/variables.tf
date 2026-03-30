# =============================================================================
# variables.tf - Input variables for Azure Private Link (classic) workspace
# =============================================================================
# All configurable inputs: naming, subscription, location, resource group,
# network (CIDR, service endpoints), tags, and workspace (public access).
# =============================================================================

# =============================================================================
# Naming
# =============================================================================

variable "prefix" {
  description = "Prefix for Databricks workspace and display names"
  type        = string
  default     = "databricks-workspace"
}

variable "resource_prefix" {
  description = "Prefix for Azure resource names (VNet, NSG, subnets). Also used to derive DBFS storage account name (alphanumeric only, 3-24 chars)."
  type        = string
  default     = "databricks-workspace"
  validation {
    condition     = can(regex("^[a-z0-9-.]{1,40}$", var.resource_prefix))
    error_message = "resource_prefix must be 1-40 characters containing only a-z, 0-9, -, ."
  }
}

# =============================================================================
# Azure Configuration
# =============================================================================

variable "az_subscription" {
  description = "Azure subscription ID where resources will be deployed"
  type        = string
}

variable "location" {
  description = "Azure region for the resource group and all resources (e.g. eastus2)"
  type        = string
}

variable "create_data_plane_resource_group" {
  description = "Set to true to create a new resource group for data plane resources; set to false to use existing_data_plane_resource_group_name"
  type        = bool
}

variable "resource_group_name" {
  description = "Name for the new resource group (when create_data_plane_resource_group is true)"
  type        = string
  default     = ""
}

variable "existing_data_plane_resource_group_name" {
  description = "Name of the existing resource group when create_data_plane_resource_group is false"
  type        = string
  default     = ""
  validation {
    condition     = var.create_data_plane_resource_group || length(var.existing_data_plane_resource_group_name) > 0
    error_message = "existing_data_plane_resource_group_name must be set when create_data_plane_resource_group is false."
  }
}

# =============================================================================
# Network Configuration
# =============================================================================

variable "cidr_dp" {
  description = "CIDR for the data plane VNet address space (e.g. 10.0.0.0/16). Must encompass all subnets. Use a block between /16 and /24."
  type        = string
  default     = "10.0.0.0/16"
  validation {
    condition     = length(regexall("^[0-9.]+/(\\d+)$", var.cidr_dp)) > 0 && tonumber(regexall("^[0-9.]+/(\\d+)$", var.cidr_dp)[0][0]) >= 16 && tonumber(regexall("^[0-9.]+/(\\d+)$", var.cidr_dp)[0][0]) <= 24
    error_message = "cidr_dp must be a CIDR block with prefix length between /16 and /24 (e.g. 10.0.0.0/16)."
  }
}

variable "subnet_workspace_cidrs" {
  description = "CIDRs for the Databricks workspace subnets: [public, private]. Must be within the VNet (cidr_dp). Each subnet must be at least /26 (Databricks does not recommend smaller). Example: [\"10.0.0.0/24\", \"10.0.1.0/24\"]."
  type        = list(string)
  validation {
    condition     = length(var.subnet_workspace_cidrs) == 2 && length([for c in var.subnet_workspace_cidrs : 1 if length(regexall("/(\\d+)$", c)) > 0 && tonumber(regexall("/(\\d+)$", c)[0][0]) <= 26]) == 2
    error_message = "subnet_workspace_cidrs must contain exactly two CIDRs [public, private], each with prefix length at least /26 (e.g. /24 or /26)."
  }
}

variable "subnet_private_endpoint_cidr" {
  description = "CIDR for the Private Link subnet (control plane and DBFS private endpoints). Must be within the VNet (cidr_dp). Example: 10.0.2.0/26."
  type        = string
}

variable "subnets_service_endpoints" {
  description = "List of Azure service endpoints to associate with the public and private subnets (e.g. [\"Microsoft.Storage\"])"
  type        = list(string)
  default     = []
}

# =============================================================================
# Databricks account (for serverless NCC)
# =============================================================================
# NCC is always created so serverless compute (SQL warehouses, serverless jobs)
# can reach DBFS over Private Link. Required for serverless to work with root storage.
# =============================================================================

variable "databricks_account_id" {
  description = "Databricks account ID (required for serverless NCC). Find it in the account console URL: https://accounts.azuredatabricks.net/accounts/<account_id>"
  type        = string
}

# =============================================================================
# Tags
# =============================================================================

variable "tags" {
  description = "Tags to apply to all Azure resources. Merged with Project = prefix (user tags take precedence)."
  type        = map(string)
  default     = {}
}

# =============================================================================
# Admin & Authentication
# =============================================================================

variable "admin_user" {
  description = "Email address of the Databricks admin user (workspace owner and metastore group member)"
  type        = string
}

variable "databricks_auth_type" {
  description = "Databricks provider auth type: azure-cli (Azure Identity), oauth-m2m (service principal), databricks-cli (OAuth/SSO profile)"
  type        = string
  default     = "azure-cli"
}

variable "databricks_client_id" {
  description = "Databricks service principal client/application ID (required for oauth-m2m auth)"
  type        = string
  default     = ""
}

variable "databricks_client_secret" {
  description = "Databricks service principal client secret (required for oauth-m2m auth)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "databricks_profile" {
  description = "Databricks CLI config profile name (used for databricks-cli auth)"
  type        = string
  default     = ""
}

# =============================================================================
# Unity Catalog
# =============================================================================

variable "existing_metastore_id" {
  description = "ID of an existing Unity Catalog metastore to assign (leave empty to auto-detect or create)"
  type        = string
  default     = ""
}

variable "create_unity_catalog" {
  description = "Whether to create a Unity Catalog with isolated storage"
  type        = bool
  default     = false
}

variable "uc_catalog_name" {
  description = "Name for the Unity Catalog (lowercase, underscores allowed)"
  type        = string
  default     = ""
}

variable "uc_storage_name" {
  description = "Azure storage account name for catalog storage (must be globally unique, 3-24 chars, lowercase alphanumeric)"
  type        = string
  default     = ""
  validation {
    condition     = var.uc_storage_name == "" || (length(var.uc_storage_name) >= 3 && length(var.uc_storage_name) <= 24)
    error_message = "uc_storage_name must be between 3 and 24 characters when provided."
  }
  validation {
    condition     = var.uc_storage_name == "" || can(regex("^[a-z0-9]+$", var.uc_storage_name))
    error_message = "uc_storage_name can only contain lowercase letters and numbers."
  }
}

variable "uc_force_destroy" {
  description = "Whether to force destroy the catalog storage on terraform destroy"
  type        = bool
  default     = false
}

