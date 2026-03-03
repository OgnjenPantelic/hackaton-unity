variable "databricks_account_id" {
  description = "Databricks Account ID"
  type        = string
  sensitive   = true
}

variable "admin_user" {
  description = "Your email address (must already exist in your Databricks account)"
  type        = string
  validation {
    condition     = can(regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", var.admin_user))
    error_message = "admin_user must be a valid email address"
  }
}

variable "prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "databricks"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "cidr_block" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.4.0.0/16"
}

variable "private_subnet_1_cidr" {
  description = "CIDR for private subnet in AZ 1 (Databricks compute). Leave empty to auto-calculate as VPC/4."
  type        = string
  default     = ""
}

variable "private_subnet_2_cidr" {
  description = "CIDR for private subnet in AZ 2 (Databricks compute). Leave empty to auto-calculate as VPC/4."
  type        = string
  default     = ""
}

variable "public_subnet_cidr" {
  description = "CIDR for public subnet (NAT gateway). Leave empty to auto-calculate as /28."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

variable "create_new_vpc" {
  description = "Whether to create a new VPC or use an existing one"
  type        = bool
  default     = true
}

variable "existing_vpc_id" {
  description = "Existing VPC ID (required if not creating new VPC)"
  type        = string
  default     = ""
}

variable "existing_subnet_ids" {
  description = "Existing private subnet IDs (required if using existing VPC)"
  type        = list(string)
  default     = []
}

variable "existing_security_group_id" {
  description = "Existing security group ID (required if using existing VPC)"
  type        = string
  default     = ""
}

# Unity Catalog (leave empty to auto-detect or create new metastore)
variable "existing_metastore_id" {
  description = "The ID of an existing metastore to use. Leave empty to auto-detect or create a new one."
  type        = string
  default     = ""
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
  description = "S3 bucket name for catalog storage (must be globally unique)"
  type        = string
  default     = ""
  validation {
    condition     = var.uc_storage_name == "" || (length(var.uc_storage_name) >= 3 && length(var.uc_storage_name) <= 63)
    error_message = "uc_storage_name must be between 3 and 63 characters when provided."
  }
  validation {
    condition     = var.uc_storage_name == "" || can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.uc_storage_name))
    error_message = "uc_storage_name must start and end with lowercase letter or number, and contain only lowercase letters, numbers, hyphens, and periods."
  }
}

variable "uc_force_destroy" {
  description = "Whether to force destroy the catalog storage bucket on terraform destroy"
  type        = bool
  default     = false
}

# Databricks authentication type
variable "databricks_auth_type" {
  description = "Databricks authentication type: 'oauth-m2m' for service principal, 'databricks-cli' for CLI profile"
  type        = string
  default     = "oauth-m2m"
}
