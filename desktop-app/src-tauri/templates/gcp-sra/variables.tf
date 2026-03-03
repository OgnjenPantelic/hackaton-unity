
# =============================================================================
# Authentication (auto-injected by the app)
# =============================================================================

variable "project" {
  description = "GCP project ID (used by root Google provider)"
  type        = string
  default     = ""
}

variable "google_project" {
  description = "GCP project ID (passed to modules)"
  type        = string
  default     = ""
}

variable "google_region" {
  description = "GCP region for resources"
  type        = string
}

variable "databricks_account_id" {
  description = "Databricks Account ID"
  type        = string
}

variable "databricks_google_service_account" {
  description = "Google service account email for Databricks"
  type        = string
  default     = ""
}

# =============================================================================
# Workspace Configuration
# =============================================================================

variable "workspace_name" {
  description = "The name of the Databricks workspace to create"
  type        = string
  default     = "my-databricks-workspace"
}

# =============================================================================
# Network Configuration
# =============================================================================

variable "nodes_ip_cidr_range" {
  description = "CIDR range for workspace nodes. Cannot be changed after creation. See https://docs.databricks.com/gcp/en/admin/cloud-configurations/gcp/network-sizing"
  type        = string
  default     = "10.0.0.0/16"
}

variable "use_existing_vpc" {
  description = "Use an existing VPC instead of creating a new one"
  type        = bool
  default     = false
}

variable "existing_vpc_name" {
  description = "Name of the existing VPC (required if use_existing_vpc is true)"
  type        = string
  default     = ""
}

variable "existing_subnet_name" {
  description = "Name of the existing subnet (required if use_existing_vpc is true)"
  type        = string
  default     = ""
}

variable "harden_network" {
  description = "Enable network hardening with firewall rules"
  type        = bool
  default     = true
}

# =============================================================================
# Private Service Connect (PSC) Configuration
# =============================================================================

variable "use_psc" {
  description = "Use Private Service Connect (PSC) for the workspace"
  type        = bool
  default     = false
}

variable "google_pe_subnet" {
  description = "Name of the subnet for PSC endpoints"
  type        = string
  default     = "databricks-pe-subnet"
}

variable "google_pe_subnet_ip_cidr_range" {
  description = "CIDR range for the PSC endpoint subnet"
  type        = string
  default     = "10.3.0.0/24"
}

variable "workspace_pe" {
  description = "Name of the workspace PSC endpoint"
  type        = string
  default     = "workspace-pe"
}

variable "relay_pe" {
  description = "Name of the relay PSC endpoint"
  type        = string
  default     = "relay-pe"
}

variable "relay_pe_ip_name" {
  description = "Private IP address name for the relay PSC endpoint"
  type        = string
  default     = ""
}

variable "workspace_pe_ip_name" {
  description = "Private IP address name for the workspace PSC endpoint"
  type        = string
  default     = ""
}

variable "relay_service_attachment" {
  description = "Relay service attachment URI. Regional values: https://docs.gcp.databricks.com/resources/supported-regions.html#psc"
  type        = string
  default     = ""
}

variable "workspace_service_attachment" {
  description = "Workspace service attachment URI. Regional values: https://docs.gcp.databricks.com/resources/supported-regions.html#psc"
  type        = string
  default     = ""
}

variable "use_existing_PSC_EP" {
  description = "Use existing PSC endpoints instead of creating new ones"
  type        = bool
  default     = false
}

variable "use_existing_databricks_vpc_eps" {
  description = "Use existing Databricks VPC Endpoints for PSC"
  type        = bool
  default     = false
}

variable "existing_databricks_vpc_ep_workspace" {
  description = "ID of the existing Databricks workspace VPC endpoint"
  type        = string
  default     = ""
}

variable "existing_databricks_vpc_ep_relay" {
  description = "ID of the existing Databricks relay VPC endpoint"
  type        = string
  default     = ""
}

# =============================================================================
# Private Access Settings
# =============================================================================

variable "use_existing_pas" {
  description = "Use existing private access settings instead of creating new ones"
  type        = bool
  default     = false
}

variable "existing_pas_id" {
  description = "ID of the existing Private Access Settings (required if use_existing_pas is true)"
  type        = string
  default     = ""
}

# =============================================================================
# Customer-Managed Encryption Keys (CMEK)
# =============================================================================

variable "use_existing_cmek" {
  description = "Use an existing CMEK resource instead of creating new key and keyring"
  type        = bool
  default     = false
}

variable "key_name" {
  description = "Cloud KMS key name for CMEK (used when creating new key)"
  type        = string
  default     = "sra-key"
}

variable "keyring_name" {
  description = "Cloud KMS keyring name for CMEK (used when creating new keyring)"
  type        = string
  default     = "sra-keyring"
}

variable "cmek_resource_id" {
  description = "Resource ID of an existing CMEK (required if use_existing_cmek is true)"
  type        = string
  default     = ""
}

# =============================================================================
# Access Control
# =============================================================================

variable "ip_addresses" {
  description = "IP addresses allowed to access the workspace"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "account_console_url" {
  description = "Databricks account console URL for your region"
  type        = string
  default     = "https://accounts.gcp.databricks.com"
}

# =============================================================================
# Metastore
# =============================================================================

variable "regional_metastore_id" {
  description = "ID of a regional Unity Catalog metastore to assign to the workspace. Leave empty to skip."
  type        = string
  default     = ""
}
