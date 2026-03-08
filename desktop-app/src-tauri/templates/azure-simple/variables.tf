# =============================================================================
# Azure Configuration
# =============================================================================

variable "tenant_id" {
    description = "Your Azure Tenant ID"
    type        = string
}

variable "azure_subscription_id" {
    description = "Your Azure Subscription ID"
    type        = string
}

variable "resource_group_name" {
    description = "The name of the resource group"
    type        = string
}

variable "create_new_resource_group" {
    description = "Whether to create a new resource group or use an existing one"
    type        = bool
    default     = true
}

variable "tags" {
    description = "A map of tags to assign to the resources"
    type        = map(string)
    default     = {}
}

# =============================================================================
# Databricks Configuration
# =============================================================================

variable "databricks_account_id" {
  description = "ID of the Databricks account"
  type        = string
}

variable "workspace_name" {
    description = "The name of the Databricks workspace"
    type        = string  
}

variable "admin_user" {
    description = "Your email address (must already exist in your Databricks account)"
    type        = string
    validation {
        condition     = can(regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", var.admin_user))
        error_message = "admin_user must be a valid email address"
    }
}

variable "root_storage_name" {
  type        = string
  description = "The root storage name. Only lowercase letters and numbers, 3-24 characters."
  validation {
    condition     = length(var.root_storage_name) >= 3 && length(var.root_storage_name) <= 24
    error_message = "root_storage_name must be between 3 and 24 characters."
  }
  validation {
    condition     = can(regex("^[a-z0-9]+$", var.root_storage_name))
    error_message = "root_storage_name can only contain lowercase letters and numbers."
  }
}

variable "location" {
    description = "The Azure region to deploy the workspace to"
    type        = string
    validation {
    condition = contains([
      "australiacentral", "australiacentral2", "australiaeast", "australiasoutheast", "brazilsouth", "canadacentral", "canadaeast", "centralindia", "centralus", "chinaeast2", "chinaeast3", "chinanorth2", "chinanorth3", "eastasia", "eastus", "eastus2", "francecentral", "germanywestcentral", "japaneast", "japanwest", "koreacentral", "mexicocentral", "northcentralus", "northeurope", "norwayeast", "qatarcentral", "southafricanorth", "southcentralus", "southeastasia", "southindia", "swedencentral", "switzerlandnorth", "switzerlandwest", "uaenorth", "uksouth", "ukwest", "westcentralus", "westeurope", "westindia", "westus", "westus2", "westus3"
    ], var.location)
    error_message = "Valid values for var.location are standard Azure regions supported by Databricks."
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

variable "create_new_vnet" {
    description = "Whether to create a new VNet"
    type        = bool
    default     = true
}

variable "vnet_name" {
    description = "The name of the virtual network"
    type        = string
    default     = ""
}

variable "vnet_resource_group_name" {
    description = "The name of the VNet resource group"
    type        = string
    default     = ""
}

variable "cidr" {
    description = "The CIDR address of the virtual network"
    type        = string
    default     = "10.0.0.0/20"
}

variable "subnet_public_cidr" {
    description = "The CIDR address of the first subnet"
    type        = string
}

variable "subnet_private_cidr" {
    description = "The CIDR address of the second subnet"
    type        = string
}

variable "workspace_sku" {
  description = "Workspace SKU tier"
  type        = string
  default     = "premium"
  validation {
    condition     = contains(["premium", "trial"], var.workspace_sku)
    error_message = "Workspace SKU must be either premium, or trial."
  }
}

# Unity Catalog configuration
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

# Databricks authentication type
variable "databricks_auth_type" {
  description = "Databricks authentication type: 'oauth-m2m' for service principal, 'databricks-cli' for CLI profile, 'azure-cli' for Azure identity"
  type        = string
  default     = "oauth-m2m"
}

variable "databricks_client_id" {
  description = "Databricks service principal client ID (required for oauth-m2m auth type)"
  type        = string
  default     = ""
}

variable "databricks_client_secret" {
  description = "Databricks service principal client secret (required for oauth-m2m auth type)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "databricks_profile" {
  description = "Databricks CLI profile name (required for databricks-cli auth type)"
  type        = string
  default     = ""
}

variable "workspace_url_override" {
  description = "Override for the workspace Databricks provider host. Used internally during terraform import when the workspace does not exist yet."
  type        = string
  default     = ""
}
