
module "customer_managed_vpc" {
  source = "./modules/workspace_deployment/"

  google_project                   = var.google_project
  google_region                    = var.google_region
  databricks_account_id            = var.databricks_account_id
  databricks_google_service_account = var.databricks_google_service_account
  workspace_name                   = var.workspace_name

  # Network
  nodes_ip_cidr_range              = var.nodes_ip_cidr_range
  use_existing_vpc                 = var.use_existing_vpc
  existing_vpc_name                = var.existing_vpc_name
  existing_subnet_name             = var.existing_subnet_name
  harden_network                   = var.harden_network

  # PSC
  use_psc                          = var.use_psc
  google_pe_subnet                 = var.google_pe_subnet
  google_pe_subnet_ip_cidr_range   = var.google_pe_subnet_ip_cidr_range
  workspace_pe                     = var.workspace_pe
  relay_pe                         = var.relay_pe
  relay_pe_ip_name                 = var.relay_pe_ip_name
  workspace_pe_ip_name             = var.workspace_pe_ip_name
  relay_service_attachment          = var.relay_service_attachment
  workspace_service_attachment      = var.workspace_service_attachment
  use_existing_PSC_EP              = var.use_existing_PSC_EP
  use_existing_databricks_vpc_eps  = var.use_existing_databricks_vpc_eps
  existing_databricks_vpc_ep_workspace = var.existing_databricks_vpc_ep_workspace
  existing_databricks_vpc_ep_relay     = var.existing_databricks_vpc_ep_relay

  # Private Access Settings
  use_existing_pas                 = var.use_existing_pas
  existing_pas_id                  = var.existing_pas_id

  # CMEK
  key_name                         = var.key_name
  keyring_name                     = var.keyring_name
  use_existing_cmek                = var.use_existing_cmek
  cmek_resource_id                 = var.cmek_resource_id

  # Access Control
  ip_addresses                     = var.ip_addresses
  account_console_url              = var.account_console_url

  # Metastore
  regional_metastore_id            = var.regional_metastore_id
}
