export const VARIABLE_DISPLAY_NAMES: Record<string, string> = {
  // Workspace
  prefix: "Workspace Name",
  workspace_name: "Workspace Name",
  databricks_workspace_name: "Workspace Name",
  admin_user: "Admin Email",
  root_storage_name: "Storage Account Name",
  workspace_sku: "Pricing Tier",
  // Cloud-specific - AWS
  region: "Region",
  // Cloud-specific - Azure
  location: "Region",
  resource_group_name: "Resource Group",
  // Cloud-specific - GCP
  google_region: "Region",
  google_project_name: "Project ID",
  google_service_account_email: "Service Account Email",
  // Network - Azure (simple)
  cidr: "VNet CIDR",
  subnet_public_cidr: "Public Subnet CIDR",
  subnet_private_cidr: "Private Subnet CIDR",
  create_new_vnet: "Create New VNet",
  vnet_name: "Existing VNet Name",
  vnet_resource_group_name: "VNet Resource Group",
  // Network - AWS (simple)
  create_new_vpc: "Create New VPC",
  cidr_block: "VPC CIDR",
  private_subnet_1_cidr: "Private Subnet 1 CIDR",
  private_subnet_2_cidr: "Private Subnet 2 CIDR",
  public_subnet_cidr: "Public Subnet CIDR (NAT)",
  // Network - GCP (simple)
  subnet_cidr: "Subnet CIDR",
  // Other
  tags: "Resource Tags",
  // Advanced
  existing_vpc_id: "Existing VPC ID",
  existing_subnet_ids: "Existing Subnet IDs",
  existing_security_group_id: "Existing Security Group ID",
  metastore_id: "Existing Metastore ID",
  existing_metastore_id: "Existing Metastore ID",

  // --- SRA: Azure ---
  resource_suffix: "Resource Suffix",
  hub_vnet_cidr: "Hub VNet CIDR",
  hub_resource_suffix: "Hub Resource Suffix",
  create_hub: "Create Hub & Account Resources",
  create_workspace_vnet: "Create Workspace VNet",
  create_workspace_resource_group: "Create Workspace Resource Group",
  cmk_enabled: "Customer-Managed Keys (CMK)",
  workspace_vnet: "Workspace VNet Configuration",
  existing_hub_vnet: "Existing Hub VNet",
  existing_workspace_vnet: "Existing Workspace VNet",
  allowed_fqdns: "Allowed Internet Domains",
  existing_resource_group_name: "Resource Group",
  existing_ncc_id: "Existing Network Connectivity Config (NCC) ID",
  existing_ncc_name: "Existing NCC Name",
  existing_network_policy_id: "Existing Network Policy Name",
  existing_cmk_ids: "Existing CMK IDs",
  databricks_metastore_id: "Metastore ID",
  workspace_security_compliance: "Security Compliance Settings",
  workspace_name_overrides: "Resource Name Overrides",
  sat_configuration: "SAT Configuration",

  // --- SRA: AWS ---
  resource_prefix: "Workspace Name",
  network_configuration: "Network Mode",
  vpc_cidr_range: "VPC CIDR Range",
  private_subnets_cidr: "Private Subnets CIDR",
  privatelink_subnets_cidr: "PrivateLink Subnets CIDR",
  sg_egress_ports: "Security Group Egress Ports",
  cmk_admin_arn: "CMK Admin ARN",
  metastore_exists: "Metastore Already Exists",
  audit_log_delivery_exists: "Audit Log Delivery Already Configured",
  enable_compliance_security_profile: "Compliance Security Profile",
  compliance_standards: "Compliance Standards",
  enable_security_analysis_tool: "Security Analysis Tool (SAT)",
  custom_vpc_id: "Custom VPC ID",
  custom_private_subnet_ids: "Custom Private Subnet IDs",
  custom_sg_id: "Custom Security Group ID",
  custom_relay_vpce_id: "Custom Relay VPC Endpoint",
  custom_workspace_vpce_id: "Custom Workspace VPC Endpoint",
  deployment_name: "Deployment Name",
  // AWS SRA: decomposed list sub-fields
  private_subnets_cidr_1: "Private Subnet CIDR 1",
  private_subnets_cidr_2: "Private Subnet CIDR 2",
  privatelink_subnets_cidr_1: "PrivateLink Subnet CIDR 1",
  privatelink_subnets_cidr_2: "PrivateLink Subnet CIDR 2",
  custom_private_subnet_ids_1: "Private Subnet ID 1",
  custom_private_subnet_ids_2: "Private Subnet ID 2",

  // --- SRA: GCP ---
  nodes_ip_cidr_range: "Workspace Subnet CIDR",
  use_existing_vpc: "Use Existing VPC",
  existing_vpc_name: "Existing VPC Name",
  existing_subnet_name: "Existing Subnet Name",
  harden_network: "Network Hardening (Firewall Rules)",
  control_plane_ips: "Control Plane IP Ranges",
  use_psc: "Private Service Connect (PSC)",
  google_pe_subnet: "PSC Subnet Name",
  google_pe_subnet_ip_cidr_range: "PSC Subnet CIDR",
  workspace_pe: "Workspace PSC Endpoint",
  relay_pe: "Relay PSC Endpoint",
  relay_pe_ip_name: "Relay PE IP Name",
  workspace_pe_ip_name: "Workspace PE IP Name",
  relay_service_attachment: "Relay Service Attachment",
  workspace_service_attachment: "Workspace Service Attachment",
  use_existing_PSC_EP: "Use Existing PSC Endpoints",
  use_existing_databricks_vpc_eps: "Use Existing Databricks VPC Endpoints",
  existing_databricks_vpc_ep_workspace: "Existing Workspace VPC Endpoint ID",
  existing_databricks_vpc_ep_relay: "Existing Relay VPC Endpoint ID",
  ip_addresses: "Allowed IP Addresses",
  account_console_url: "Account Console URL",
  key_name: "CMEK Key Name",
  keyring_name: "CMEK Keyring Name",
  use_existing_cmek: "Use Existing CMEK",
  cmek_resource_id: "Existing CMEK Resource ID",
  use_existing_pas: "Use Existing Private Access",
  existing_pas_id: "Existing Private Access Settings ID",
  regional_metastore_id: "Regional Metastore ID",
};

export const VARIABLE_DESCRIPTION_OVERRIDES: Record<string, string> = {
  // Workspace
  prefix: "Name for your Databricks workspace. Also used as prefix for storage, credentials, and network resources.",
  workspace_name: "Name for your Databricks workspace.",
  databricks_workspace_name: "Name for your Databricks workspace.",
  admin_user: "Email address of the workspace admin. Must already exist in your Databricks account.",
  root_storage_name: "Storage account (Azure: 3-24 chars) or S3 bucket (AWS: 3-63 chars). Lowercase letters and numbers only.",
  workspace_sku: "Pricing tier for the workspace. Premium is required for Unity Catalog.",
  // Cloud-specific - AWS
  region: "AWS region where your Databricks workspace will be deployed.",
  // Cloud-specific - Azure
  location: "Azure region where your Databricks workspace will be deployed.",
  resource_group_name: "Azure resource group to deploy the workspace into. Select an existing one or enter a new name.",
  // Cloud-specific - GCP
  google_region: "GCP region where your Databricks workspace will be deployed.",
  google_project_name: "GCP project ID for workspace resources.",
  google_service_account_email: "Service account email used for authentication. Must have Owner role and be added to Databricks Account Console with admin role.",
  tags: "Optional key-value pairs to tag/label all created resources for cost tracking and organization.",
  // Network - Azure
  create_new_vnet: "Enable to create a new VNet, or disable to use an existing VNet. New subnets will be created in either case.",
  vnet_name: "Name of your existing VNet where Databricks subnets will be created.",
  vnet_resource_group_name: "Resource group where the VNet is located. Auto-filled from the workspace resource group above — change this if your VNet is in a different resource group.",
  cidr: "Use a prefix between /16 and /24 for optimal sizing.",
  subnet_public_cidr: "CIDR range for the public (host) subnet within the VNet address space.",
  subnet_private_cidr: "CIDR range for the private (container) subnet within the VNet address space.",
  // Network - AWS
  create_new_vpc: "Enable to create a new VPC, or disable to use an existing VPC with your own subnets and security group.",
  cidr_block: "Address space for the new VPC (e.g., 10.4.0.0/16).",
  private_subnet_1_cidr: "CIDR for private subnet in AZ 1 (Databricks compute). Leave empty to auto-calculate from VPC CIDR.",
  private_subnet_2_cidr: "CIDR for private subnet in AZ 2 (Databricks compute). Leave empty to auto-calculate from VPC CIDR.",
  public_subnet_cidr: "CIDR for public subnet (NAT gateway). Small /28 subnet is recommended.",
  // Network - GCP
  subnet_cidr: "CIDR range for the Databricks subnet (e.g., 10.0.0.0/16).",
  // Advanced
  existing_vpc_id: "Use an existing VPC instead of creating a new one. Leave empty for auto-creation.",
  existing_subnet_ids: "Use existing subnets. Required if using an existing VPC.",
  existing_security_group_id: "Use an existing security group. Required if using an existing VPC.",
  metastore_id: "Use an existing Unity Catalog metastore. Leave empty to auto-detect or create a new one.",
  existing_metastore_id: "Required. The ID of your existing Unity Catalog metastore in this region.",
  uc_catalog_name: "Custom name for the workspace catalog and S3 bucket. Leave empty to auto-generate from resource prefix.",

  // --- SRA: Azure ---
  resource_suffix: "Short identifier used as a suffix for all Azure resource names (resource group, VNet, workspace, storage accounts). Lowercase letters and numbers only.",
  hub_vnet_cidr: "CIDR block for the hub Virtual Network. Required when creating hub infrastructure.",
  hub_resource_suffix: "Naming suffix for hub resources. Required when creating hub infrastructure.",
  create_hub: "Create hub infrastructure (firewall, VNet, CMK) and Databricks account resources (NCC, network policy, metastore). Disable if these already exist — you'll need to provide their IDs.",
  create_workspace_vnet: "Create a new SRA-managed workspace VNet. Disable to use an existing VNet.",
  workspace_vnet: "Spoke network configuration for the workspace VNet.",
  create_workspace_resource_group: "Create a new resource group for the workspace. Disable to use an existing one.",
  existing_resource_group_name: "Azure resource group to deploy the workspace into. Select an existing one or enter a new name.",
  cmk_enabled: "Encrypt managed disks and services with customer-managed keys. Enabled by default.",
  existing_hub_vnet: "Required when using an existing hub. Provide the Azure resource IDs for the hub VNet and route table.",
  existing_workspace_vnet: "Required when using an existing workspace VNet. Provide the Azure resource IDs for the VNet, subnets, NSG associations, and private DNS zones.",
  existing_cmk_ids: "Required because Customer-Managed Keys (CMK) is enabled. To skip providing these, disable the CMK toggle in the Encryption section.",
  allowed_fqdns: "Domains workspaces can reach from classic compute (via firewall) and serverless compute (via network policy). No internet access is allowed by default.",
  existing_ncc_id: "Required when using existing hub. ID of an existing Network Connectivity Config (NCC). The NCC controls serverless private endpoints. Find it in Account Console → Settings → Network connectivity configurations.",
  existing_ncc_name: "Name of the existing NCC. Used to label private endpoint approvals. Find it in Account Console → Settings → Network connectivity configurations (e.g. ncc-eastus-hub1abc).",
  existing_network_policy_id: "Name of the existing network policy that controls serverless egress rules. Find it in Account Console → Settings → Network policies (e.g. np-hub1abc-restrictive).",
  databricks_metastore_id: "ID of an existing Unity Catalog metastore. Must be created before deploying a workspace. Find it in Account Console → Data → Metastores.",
  workspace_security_compliance: "Enhanced security compliance configuration for the workspace.",
  sat_configuration: "Security Analysis Tool configuration (enable, schema, catalog, serverless). See https://github.com/databricks-industry-solutions/security-analysis-tool",
  sat_service_principal: "Service principal for running SAT. Leave empty to create one automatically.",

  // --- SRA: AWS ---
  resource_prefix: "Name for your workspace. Also used as prefix for all resource names (1-26 chars, lowercase letters, numbers, hyphens, and dots).",
  network_configuration: "Network mode: 'isolated' creates a new VPC with PrivateLink; 'custom' uses your existing VPC.",
  vpc_cidr_range: "CIDR range for the VPC (e.g. 10.0.0.0/16).",
  private_subnets_cidr: "CIDR blocks for private subnets within the VPC.",
  privatelink_subnets_cidr: "CIDR blocks for PrivateLink endpoint subnets.",
  sg_egress_ports: "Egress ports allowed in security groups. Pre-filled with Databricks defaults — modify only if needed.",
  cmk_admin_arn: "Optional. ARN of the IAM principal that will administer the CMK. Leave empty to skip.",
  metastore_exists: "Whether a Unity Catalog metastore already exists in this region.",
  audit_log_delivery_exists: "Check if audit log delivery is already configured for this account. Leave unchecked to create it.",
  enable_compliance_security_profile: "⚠ IRREVERSIBLE — Once enabled, it cannot be removed. The only way to revert is to delete the workspace. Enables the paid Enhanced Security and Compliance add-on which adds a per-DBU surcharge to all compute. Contact your Databricks account team for exact pricing.",
  compliance_standards: "Compliance standards to apply (e.g. HIPAA, PCI-DSS). JSON array format.",
  enable_security_analysis_tool: "Optional. Enable the Security Analysis Tool (SAT) for security monitoring.",
  deployment_name: "Optional. Custom deployment name for the workspace. Must be pre-enabled by Databricks.",
  custom_vpc_id: "ID of your existing VPC.",
  custom_sg_id: "ID of your existing security group.",
  custom_relay_vpce_id: "Existing Relay VPC Endpoint ID. Required in custom network mode.",
  custom_workspace_vpce_id: "Existing Workspace VPC Endpoint ID. Required in custom network mode.",

  // --- SRA: GCP ---
  nodes_ip_cidr_range: "CIDR range for workspace nodes. Cannot be changed after creation.",
  use_existing_vpc: "Use an existing VPC instead of creating a new one.",
  existing_vpc_name: "Name of the existing VPC in your GCP project.",
  existing_subnet_name: "Name of the existing subnet within the VPC.",
  harden_network: "Enable firewall rules that restrict egress traffic to only Databricks control plane and GCP APIs.",
  control_plane_ips: "Regional Databricks control-plane IP/CIDR ranges. Required when network hardening is enabled without PSC. See https://docs.databricks.com/gcp/en/resources/ip-domain-region",
  use_psc: "Use Private Service Connect for secure, private connectivity to Databricks. Recommended for production.",
  google_pe_subnet: "Subnet providing IP addresses to Private Service Connect endpoints.",
  google_pe_subnet_ip_cidr_range: "CIDR range for the PSC endpoint subnet.",
  use_existing_PSC_EP: "Use existing GCP PSC forwarding rules instead of creating new ones.",
  use_existing_databricks_vpc_eps: "Use existing Databricks-registered VPC endpoints for PSC.",
  existing_databricks_vpc_ep_workspace: "ID of an existing Databricks workspace VPC endpoint.",
  existing_databricks_vpc_ep_relay: "ID of an existing Databricks relay VPC endpoint.",
  workspace_pe: "Name for the workspace PSC endpoint.",
  relay_pe: "Name for the relay PSC endpoint.",
  regional_metastore_id: "ID of a regional Unity Catalog metastore to assign. Leave empty to skip metastore assignment.",
  ip_addresses: "IP addresses allowed to connect to the workspace. JSON array format (e.g. [\"0.0.0.0/0\"]).",
  key_name: "Name of the CMEK key for workspace encryption.",
  keyring_name: "Name of the CMEK keyring containing the encryption key.",
  use_existing_cmek: "Use an existing CMEK instead of creating a new one.",
  cmek_resource_id: "Resource ID of the existing CMEK key.",
  use_existing_pas: "Optional. Use existing Private Access Settings instead of creating new ones.",
  existing_pas_id: "ID of the existing Private Access Settings (found in the Databricks Account Console).",
  relay_service_attachment: "Relay service attachment URI. Region-specific — see Databricks docs.",
  workspace_service_attachment: "Workspace service attachment URI. Region-specific — see Databricks docs.",
  account_console_url: "Databricks account console URL for your region.",
  relay_pe_ip_name: "Optional. Private IP address name for the relay PSC endpoint.",
  workspace_pe_ip_name: "Optional. Private IP address name for the workspace PSC endpoint.",
};

export const PLACEHOLDER_OVERRIDES: Record<string, string> = {
  existing_ncc_id: "5a29629b-8098-43e8-87c8-26ec05211924",
  existing_ncc_name: "ncc-eastus-hub1abc",
  existing_network_policy_id: "np-hub1abc-restrictive",
};

export const EXCLUDE_VARIABLES = [
  "databricks_account_id",
  "databricks_client_id",
  "databricks_client_secret",
  "databricks_profile",
  "databricks_auth_type",
  "aws_account_id",
  "aws_access_key_id",
  "aws_secret_access_key",
  "aws_session_token",
  "tenant_id",
  "azure_tenant_id",
  "azure_subscription_id",
  "azure_client_id",
  "azure_client_secret",
  "create_new_resource_group",
  // GCP variables - collected in credentials screen
  "gcp_project_id",
  "google_project",
  "google_project_name",
  "gcp_credentials_json",
  "google_service_account_email",
  // Unity Catalog variables - configured in dedicated UC setup screen
  "existing_metastore_id",
  "metastore_exists",
  "create_unity_catalog",
  "uc_catalog_name",
  "uc_storage_name",
  "uc_force_destroy",
  "databricks_metastore_id",
  // SRA: Azure - auto-injected or internal
  "create_workspace_resource_group",
  "subscription_id",
  "sat_force_destroy",
  "catalog_force_destroy",
  // SRA: AWS - hidden from form (requires Databricks rep pre-enablement)
  "deployment_name",
  // SRA: AWS - region-specific config maps with sensible defaults
  "artifact_storage_bucket",
  "shared_datasets_bucket",
  "region_name_config",
  "scc_relay_config",
  "system_table_bucket_config",
  "log_storage_bucket_config",
  "workspace_config",
  "aws_partition",
  "databricks_provider_host",
  "databricks_gov_shard",
  // SRA: GCP - auto-injected from credentials
  "databricks_google_service_account",
  "project",
  // SRA: truly internal / power-user objects (edit tfvars directly)
  "workspace_name_overrides",
] as const;

/**
 * Sub-field decomposition for complex Terraform object variables.
 * These are rendered as individual form fields in the UI and reconstructed
 * into proper objects before generating tfvars.
 */
export interface ObjectSubField {
  key: string;
  path: string[];
  label: string;
  description: string;
  fieldType: "string" | "number" | "bool" | "select";
  required?: boolean;
  placeholder?: string;
  sensitive?: boolean;
}

export const OBJECT_FIELD_DECOMPOSITION: Record<string, ObjectSubField[]> = {
  // Azure SRA: workspace VNet config (shown when create_workspace_vnet=true)
  workspace_vnet: [
    { key: "workspace_vnet__cidr", path: ["cidr"], label: "Workspace VNet CIDR", description: "CIDR block for the workspace VNet.", fieldType: "string", required: true, placeholder: "10.0.0.0/20" },
    { key: "workspace_vnet__new_bits", path: ["new_bits"], label: "Subnet Layout", description: "How to divide the VNet. More subnets means smaller subnets with fewer nodes each.", fieldType: "select", placeholder: "2" },
  ],
  // Azure SRA: existing hub VNet (shown when create_hub=false)
  existing_hub_vnet: [
    { key: "existing_hub_vnet__route_table_id", path: ["route_table_id"], label: "Hub Route Table ID", description: "Azure resource ID of the hub route table.", fieldType: "string", required: true, placeholder: "/subscriptions/.../routeTables/..." },
    { key: "existing_hub_vnet__vnet_id", path: ["vnet_id"], label: "Hub VNet ID", description: "Azure resource ID of the existing hub VNet.", fieldType: "string", required: true, placeholder: "/subscriptions/.../virtualNetworks/..." },
  ],
  // Azure SRA: existing CMK IDs (shown when create_hub=false)
  existing_cmk_ids: [
    { key: "existing_cmk_ids__key_vault_id", path: ["key_vault_id"], label: "Key Vault ID", description: "Azure resource ID of the Key Vault containing CMK keys. Find in Azure Portal → Key Vaults → Properties.", fieldType: "string", required: true },
    { key: "existing_cmk_ids__managed_disk_key_id", path: ["managed_disk_key_id"], label: "Managed Disk Key ID", description: "Azure resource ID of the managed disk encryption key. Find in Azure Portal → Key Vaults → Keys.", fieldType: "string", required: true },
    { key: "existing_cmk_ids__managed_services_key_id", path: ["managed_services_key_id"], label: "Managed Services Key ID", description: "Azure resource ID of the managed services encryption key. Find in Azure Portal → Key Vaults → Keys.", fieldType: "string", required: true },
  ],
  // Azure SRA: existing workspace VNet (shown when create_workspace_vnet=false)
  existing_workspace_vnet: [
    { key: "existing_workspace_vnet__nc__vnet_id", path: ["network_configuration", "virtual_network_id"], label: "Virtual Network ID", description: "Azure resource ID of the existing workspace VNet. Find in Azure Portal → Virtual Networks → Properties → Resource ID.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__nc__private_subnet", path: ["network_configuration", "private_subnet_id"], label: "Private Subnet ID", description: "Azure resource ID of the private subnet for Databricks compute. Find in Azure Portal → Virtual Networks → Subnets.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__nc__public_subnet", path: ["network_configuration", "public_subnet_id"], label: "Public Subnet ID", description: "Azure resource ID of the public subnet for Databricks compute. Find in Azure Portal → Virtual Networks → Subnets.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__nc__pe_subnet", path: ["network_configuration", "private_endpoint_subnet_id"], label: "Private Endpoint Subnet ID", description: "Azure resource ID of the private endpoint subnet. Find in Azure Portal → Virtual Networks → Subnets.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__nc__priv_nsg", path: ["network_configuration", "private_subnet_network_security_group_association_id"], label: "Private Subnet NSG Association", description: "NSG association ID for the private subnet. Find in Azure Portal → Network Security Groups → Properties.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__nc__pub_nsg", path: ["network_configuration", "public_subnet_network_security_group_association_id"], label: "Public Subnet NSG Association", description: "NSG association ID for the public subnet. Find in Azure Portal → Network Security Groups → Properties.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__dns__backend", path: ["dns_zone_ids", "backend"], label: "DNS Zone - Backend", description: "Private DNS zone ID for backend connectivity (privatelink.azuredatabricks.net). Find in Azure Portal → Private DNS Zones.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__dns__dfs", path: ["dns_zone_ids", "dfs"], label: "DNS Zone - DFS", description: "Private DNS zone ID for Data Lake Storage (privatelink.dfs.core.windows.net). Find in Azure Portal → Private DNS Zones.", fieldType: "string", required: true },
    { key: "existing_workspace_vnet__dns__blob", path: ["dns_zone_ids", "blob"], label: "DNS Zone - Blob", description: "Private DNS zone ID for Blob Storage (privatelink.blob.core.windows.net). Find in Azure Portal → Private DNS Zones.", fieldType: "string", required: true },
  ],
  // Azure SRA: workspace security compliance (optional)
  workspace_security_compliance: [
    { key: "wsc__auto_update", path: ["automatic_cluster_update_enabled"], label: "Automatic Cluster Updates", description: "Enable automatic cluster updates for security patches.", fieldType: "bool" },
    { key: "wsc__csp_enabled", path: ["compliance_security_profile_enabled"], label: "Compliance Security Profile", description: "⚠ IRREVERSIBLE — Once enabled, it cannot be removed. The only way to revert is to delete the workspace. Enables the paid Enhanced Security and Compliance add-on which adds a per-DBU surcharge to all compute. Contact your Databricks account team for exact pricing.", fieldType: "bool" },
    { key: "wsc__csp_standards", path: ["compliance_security_profile_standards"], label: "Compliance Standards", description: "Compliance standards (e.g. HIPAA, PCI-DSS). JSON array format.", fieldType: "string", placeholder: '["HIPAA"]' },
    { key: "wsc__esm", path: ["enhanced_security_monitoring_enabled"], label: "Enhanced Security Monitoring", description: "Adds security agents to compute nodes to monitor suspicious activity, file access, and network connections. Part of the Enhanced Security and Compliance add-on.", fieldType: "bool" },
  ],
  // Azure SRA: SAT configuration (optional)
  sat_configuration: [
    { key: "sat__enabled", path: ["enabled"], label: "Enable SAT", description: "Enable the Security Analysis Tool.", fieldType: "bool" },
    { key: "sat__schema_name", path: ["schema_name"], label: "SAT Schema Name", description: "Schema name for SAT data.", fieldType: "string", placeholder: "sat" },
    { key: "sat__catalog_name", path: ["catalog_name"], label: "SAT Catalog Name", description: "Catalog name for SAT data.", fieldType: "string", placeholder: "sat" },
    { key: "sat__run_on_serverless", path: ["run_on_serverless"], label: "Run SAT on Serverless", description: "Run SAT on serverless compute.", fieldType: "bool" },
  ],
  // Azure SRA: SAT service principal (optional)
  sat_service_principal: [
    { key: "sat_sp__client_id", path: ["client_id"], label: "SAT SP Client ID", description: "Client ID of existing service principal. Leave empty to create one.", fieldType: "string" },
    { key: "sat_sp__client_secret", path: ["client_secret"], label: "SAT SP Client Secret", description: "Client secret. Leave empty to create one.", fieldType: "string", sensitive: true },
    { key: "sat_sp__name", path: ["name"], label: "SAT SP Name", description: "Name for the service principal.", fieldType: "string", placeholder: "spSAT" },
  ],
};

/**
 * Decomposition for Terraform list(string) variables into individual UI fields.
 * Each sub-field renders as its own input and gets reassembled into an array before
 * generating tfvars.
 */
export interface ListSubField {
  key: string;
  index: number;
  label: string;
  description: string;
  required?: boolean;
  placeholder?: string;
}

export const LIST_FIELD_DECOMPOSITION: Record<string, ListSubField[]> = {
  // AWS SRA: private subnets (when isolated network mode)
  private_subnets_cidr: [
    { key: "private_subnets_cidr_1", index: 0, label: "Private Subnet CIDR 1", description: "CIDR for private subnet in AZ 1 (Databricks compute).", required: true, placeholder: "10.0.0.0/18" },
    { key: "private_subnets_cidr_2", index: 1, label: "Private Subnet CIDR 2", description: "CIDR for private subnet in AZ 2 (Databricks compute).", required: true, placeholder: "10.0.64.0/18" },
  ],
  // AWS SRA: PrivateLink subnets (when isolated network mode)
  privatelink_subnets_cidr: [
    { key: "privatelink_subnets_cidr_1", index: 0, label: "PrivateLink Subnet CIDR 1", description: "CIDR for PrivateLink endpoint subnet in AZ 1. Fixed /28 — only hosts a few ENIs.", required: true, placeholder: "10.0.128.0/28" },
    { key: "privatelink_subnets_cidr_2", index: 1, label: "PrivateLink Subnet CIDR 2", description: "CIDR for PrivateLink endpoint subnet in AZ 2. Fixed /28 — only hosts a few ENIs.", required: true, placeholder: "10.0.128.16/28" },
  ],
  // AWS SRA: custom private subnet IDs (when custom network mode)
  custom_private_subnet_ids: [
    { key: "custom_private_subnet_ids_1", index: 0, label: "Private Subnet ID 1", description: "ID of the first existing private subnet.", required: true, placeholder: "subnet-..." },
    { key: "custom_private_subnet_ids_2", index: 1, label: "Private Subnet ID 2", description: "ID of the second existing private subnet.", required: true, placeholder: "subnet-..." },
  ],
  // AWS simple: existing subnet IDs (when using existing VPC)
  existing_subnet_ids: [
    { key: "existing_subnet_ids_1", index: 0, label: "Existing Subnet ID 1", description: "ID of the first existing private subnet (AZ 1).", required: true, placeholder: "subnet-..." },
    { key: "existing_subnet_ids_2", index: 1, label: "Existing Subnet ID 2", description: "ID of the second existing private subnet (AZ 2).", required: true, placeholder: "subnet-..." },
  ],
};

export const FQDN_GROUPS: Record<string, { id: string; label: string; description: string; urls: string[] }[]> = {
  allowed_fqdns: [
    { id: "azure_mgmt", label: "Azure Management", description: "Required for SAT and Azure API access.", urls: ["management.azure.com", "login.microsoftonline.com"] },
    { id: "python", label: "Python Packages", description: "PyPI and Python package registries.", urls: ["python.org", "*.python.org", "pypi.org", "*.pypi.org", "pythonhosted.org", "*.pythonhosted.org"] },
    { id: "r", label: "R Packages", description: "CRAN and R package registries.", urls: ["cran.r-project.org", "*.cran.r-project.org", "r-project.org"] },
  ],
};

export const COMPLIANCE_STANDARDS: Record<string, { value: string; label: string }[]> = {
  aws: [
    { value: "HIPAA", label: "HIPAA" },
    { value: "PCI_DSS", label: "PCI-DSS" },
    { value: "FEDRAMP_MODERATE", label: "FedRAMP Moderate" },
    { value: "FEDRAMP_HIGH", label: "FedRAMP High" },
    { value: "IRAP", label: "IRAP" },
    { value: "CYBER_ESSENTIALS_PLUS", label: "UK Cyber Essentials Plus" },
    { value: "CCCS_MEDIUM", label: "CCCS Medium (Protected B)" },
  ],
  azure: [
    { value: "HIPAA", label: "HIPAA" },
    { value: "PCI_DSS", label: "PCI-DSS" },
    { value: "TISAX", label: "TISAX" },
    { value: "C5", label: "C5" },
    { value: "K_FSI", label: "K-FSI" },
    { value: "CCCS_MEDIUM", label: "CCCS Medium (Protected B)" },
    { value: "CYBER_ESSENTIALS_PLUS", label: "UK Cyber Essentials Plus" },
    { value: "IRAP", label: "IRAP" },
    { value: "ISMAP", label: "ISMAP" },
    { value: "HITRUST", label: "HITRUST" },
  ],
  gcp: [
    { value: "HIPAA", label: "HIPAA" },
    { value: "PCI_DSS", label: "PCI-DSS" },
    { value: "C5", label: "C5" },
  ],
};

export const CONDITIONAL_FIELD_VISIBILITY: {
  toggle: string;
  defaultChecked: boolean;
  showWhenChecked: string[];
  showWhenUnchecked: string[];
}[] = [
  // AWS simple: create new VPC vs use existing
  {
    toggle: "create_new_vpc",
    defaultChecked: true,
    showWhenChecked: ["cidr_block", "private_subnet_1_cidr", "private_subnet_2_cidr", "public_subnet_cidr"],
    showWhenUnchecked: ["existing_vpc_id", "existing_subnet_ids", "existing_security_group_id"],
  },
  // Azure SRA: hub creation vs bring-your-own hub
  {
    toggle: "create_hub",
    defaultChecked: true,
    showWhenChecked: ["hub_vnet_cidr", "hub_resource_suffix", "allowed_fqdns", "sat_configuration", "sat_service_principal"],
    showWhenUnchecked: ["existing_hub_vnet", "existing_cmk_ids", "existing_ncc_id", "existing_ncc_name", "existing_network_policy_id"],
  },
  // Azure SRA: CMK enabled shows existing CMK IDs (when hub is not being created)
  {
    toggle: "cmk_enabled",
    defaultChecked: true,
    showWhenChecked: ["existing_cmk_ids"],
    showWhenUnchecked: [],
  },
  // Azure SRA: workspace VNet creation vs bring-your-own
  {
    toggle: "create_workspace_vnet",
    defaultChecked: true,
    showWhenChecked: ["workspace_vnet"],
    showWhenUnchecked: ["existing_workspace_vnet"],
  },
  // AWS SRA: compliance security profile controls compliance_standards
  {
    toggle: "enable_compliance_security_profile",
    defaultChecked: false,
    showWhenChecked: ["compliance_standards"],
    showWhenUnchecked: [],
  },
  // GCP SRA: use existing VPC vs create new
  {
    toggle: "use_existing_vpc",
    defaultChecked: false,
    showWhenChecked: ["existing_vpc_name", "existing_subnet_name"],
    showWhenUnchecked: ["nodes_ip_cidr_range"],
  },
  // GCP SRA: network hardening shows control plane IPs (only needed without PSC)
  {
    toggle: "harden_network",
    defaultChecked: true,
    showWhenChecked: ["control_plane_ips"],
    showWhenUnchecked: [],
  },
  // GCP SRA: enable Private Service Connect
  {
    toggle: "use_psc",
    defaultChecked: false,
    showWhenChecked: [
      "google_pe_subnet", "google_pe_subnet_ip_cidr_range",
      "workspace_pe", "relay_pe",
      "relay_pe_ip_name", "workspace_pe_ip_name",
      "relay_service_attachment", "workspace_service_attachment",
      "use_existing_PSC_EP", "use_existing_databricks_vpc_eps",
      "existing_databricks_vpc_ep_workspace", "existing_databricks_vpc_ep_relay",
    ],
    showWhenUnchecked: ["control_plane_ips"],
  },
  // GCP SRA: use existing CMEK vs create new
  {
    toggle: "use_existing_cmek",
    defaultChecked: false,
    showWhenChecked: ["cmek_resource_id"],
    showWhenUnchecked: ["key_name", "keyring_name"],
  },
  // GCP SRA: use existing PAS vs create new
  {
    toggle: "use_existing_pas",
    defaultChecked: false,
    showWhenChecked: ["existing_pas_id"],
    showWhenUnchecked: [],
  },
];

/**
 * Visual field groups: render multiple standalone fields inside a styled subsection box,
 * similar to how OBJECT_FIELD_DECOMPOSITION groups sub-fields under a header.
 */
export const FIELD_GROUPS: {
  label: string;
  description: string;
  fields: string[];
}[] = [
  {
    label: "Existing Databricks Account Resources",
    description: "These Databricks account-level resources must exist before deploying a workspace. Create them in the Account Console or provide IDs from a previous hub deployment.",
    fields: ["existing_ncc_id", "existing_ncc_name", "existing_network_policy_id"],
  },
];

export const CONDITIONAL_SELECT_VISIBILITY: {
  toggle: string;
  defaultValue: string;
  options: { value: string; showFields: string[] }[];
}[] = [
  // AWS SRA: isolated vs custom network
  {
    toggle: "network_configuration",
    defaultValue: "isolated",
    options: [
      {
        value: "isolated",
        showFields: ["vpc_cidr_range", "private_subnets_cidr", "privatelink_subnets_cidr", "sg_egress_ports"],
      },
      {
        value: "custom",
        showFields: ["custom_vpc_id", "custom_private_subnet_ids", "custom_sg_id", "custom_relay_vpce_id", "custom_workspace_vpce_id"],
      },
    ],
  },
];
