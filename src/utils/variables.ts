import { TerraformVariable } from "../types";
import { EXCLUDE_VARIABLES, VARIABLE_DISPLAY_NAMES, DEFAULTS } from "../constants";
import { computeAwsSubnets, computeAzurePlSubnets } from "./cidr";

function isValidJson(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

/**
 * Canonical section order for the configuration form.
 */
export const SECTION_ORDER = ["Workspace", "Hub Infrastructure", "Workspace Network", "Firewall Rules", "Encryption", "Advanced: Network Configuration", "Security & Compliance", "Metastore & Catalog", "Additional Settings", "Tags"];

/**
 * Field display order within each section (lower number = displayed first).
 */
const FIELD_ORDER: Record<string, number> = {
  // Workspace - consistent order across clouds: name, region, admin, then cloud-specific extras
  prefix: 1,
  workspace_name: 1,
  databricks_workspace_name: 1,
  resource_prefix: 1,
  resource_suffix: 1,
  region: 2,
  location: 2,
  google_region: 2,
  admin_user: 3,
  resource_group_name: 4,
  root_storage_name: 5,
  workspace_sku: 6,
  // Tags
  tags: 1,
  // Hub Infrastructure (Azure SRA)
  create_hub: 1,
  hub_vnet_cidr: 2,
  hub_resource_suffix: 3,
  existing_hub_vnet: 4,
  existing_ncc_id: 5,
  existing_ncc_name: 6,
  existing_network_policy_id: 7,
  existing_resource_group_name: 4,
  // Workspace Network (Azure SRA)
  create_workspace_vnet: 1,
  workspace_vnet: 2,
  existing_workspace_vnet: 3,
  // Firewall Rules (Azure SRA)
  allowed_fqdns: 1,
  // Encryption (Azure SRA)
  cmk_enabled: 1,
  existing_cmk_ids: 2,
  // Advanced: Network - toggle first, CIDRs, then existing resources (non-SRA)
  create_new_vnet: 1,
  network_configuration: 1,
  create_new_vpc: 1,
  cidr_block: 4,
  private_subnet_1_cidr: 5,
  private_subnet_2_cidr: 6,
  public_subnet_cidr: 7,
  cidr: 4,
  vpc_cidr_range: 4,
  subnet_cidr: 5,
  subnet_public_cidr: 5,
  subnet_private_cidr: 6,
  private_subnets_cidr: 5,
  privatelink_subnets_cidr: 6,
  vnet_name: 8,
  vnet_resource_group_name: 9,
  sg_egress_ports: 10,
  existing_vpc_id: 20,
  existing_subnet_ids: 21,
  existing_security_group_id: 22,
  custom_vpc_id: 20,
  custom_private_subnet_ids: 21,
  custom_sg_id: 22,
  custom_relay_vpce_id: 23,
  custom_workspace_vpce_id: 24,
  databricks_metastore_id: 25,
  // GCP SRA: network
  nodes_ip_cidr_range: 3,
  use_existing_vpc: 1,
  existing_vpc_name: 2,
  existing_subnet_name: 3,
  harden_network: 10,
  control_plane_ips: 10.5,
  // GCP SRA: PSC fields
  use_psc: 11,
  google_pe_subnet: 12,
  google_pe_subnet_ip_cidr_range: 13,
  workspace_pe: 14,
  relay_pe: 15,
  relay_pe_ip_name: 16,
  workspace_pe_ip_name: 17,
  relay_service_attachment: 18,
  workspace_service_attachment: 19,
  use_existing_PSC_EP: 20,
  use_existing_databricks_vpc_eps: 21,
  existing_databricks_vpc_ep_workspace: 22,
  existing_databricks_vpc_ep_relay: 23,
  // GCP SRA: PAS
  use_existing_pas: 24,
  existing_pas_id: 25,
  // GCP SRA: metastore
  regional_metastore_id: 1,
  // Unity Catalog (SRA)
  existing_metastore_id: 1,
  uc_catalog_name: 2,
  // Security
  enable_compliance_security_profile: 1,
  compliance_standards: 2,
  enable_security_analysis_tool: 3,
  cmk_admin_arn: 4,
  use_existing_cmek: 5,
  key_name: 6,
  keyring_name: 7,
  cmek_resource_id: 8,
  // Optional
  metastore_exists: 1,
  audit_log_delivery_exists: 2,
  deployment_name: 3,
  ip_addresses: 4,
  account_console_url: 5,
};

/**
 * Groups Terraform variables by section for display in the configuration form.
 * Returns sections in canonical order with fields sorted within each section.
 */
export function groupVariablesBySection(
  variables: TerraformVariable[],
  templateId?: string
): Record<string, TerraformVariable[]> {
  const isGcpSra = templateId === "gcp-sra";
  const SRA_UC_FIELDS = ["existing_metastore_id", "uc_catalog_name"];
  const sectionMap: Record<string, string> = {
    // Workspace
    prefix: "Workspace",
    workspace_name: "Workspace",
    databricks_workspace_name: "Workspace",
    admin_user: "Workspace",
    root_storage_name: "Workspace",
    workspace_sku: "Workspace",
    region: "Workspace",
    location: "Workspace",
    google_region: "Workspace",
    resource_group_name: "Workspace",
    resource_prefix: "Workspace",
    resource_suffix: "Workspace",
    // Azure PL: resource group fields
    create_data_plane_resource_group: "Workspace",
    existing_data_plane_resource_group_name: "Workspace",

    // Tags
    tags: "Tags",

    // Advanced: Network Configuration (all network + existing resource fields)
    // Azure PL: network fields
    cidr_dp: "Advanced: Network Configuration",
    subnet_workspace_cidrs: "Advanced: Network Configuration",
    subnet_private_endpoint_cidr: "Advanced: Network Configuration",
    subnets_service_endpoints: "Advanced: Network Configuration",
    vpc_id: "Advanced: Network Configuration",
    vpc_cidr_range: "Advanced: Network Configuration",
    create_new_vpc: "Advanced: Network Configuration",
    cidr_block: "Advanced: Network Configuration",
    private_subnet_1_cidr: "Advanced: Network Configuration",
    private_subnet_2_cidr: "Advanced: Network Configuration",
    public_subnet_cidr: "Advanced: Network Configuration",
    vnet_name: "Advanced: Network Configuration",
    vnet_resource_group_name: "Advanced: Network Configuration",
    cidr: "Advanced: Network Configuration",
    availability_zones: "Advanced: Network Configuration",
    subnet_ids: "Advanced: Network Configuration",
    private_subnets_cidr: "Advanced: Network Configuration",
    public_subnets_cidr: "Advanced: Network Configuration",
    subnet_public_cidr: "Advanced: Network Configuration",
    subnet_private_cidr: "Advanced: Network Configuration",
    subnet_cidr: "Advanced: Network Configuration",
    create_new_vnet: "Advanced: Network Configuration",
    security_group_ids: "Advanced: Network Configuration",
    sg_egress_ports: "Advanced: Network Configuration",
    existing_vpc_id: "Advanced: Network Configuration",
    existing_subnet_ids: "Advanced: Network Configuration",
    existing_security_group_id: "Advanced: Network Configuration",
    // SRA: Azure network fields (remapped per-template below for azure-sra)
    create_hub: "Advanced: Network Configuration",
    hub_vnet_cidr: "Advanced: Network Configuration",
    hub_resource_suffix: "Advanced: Network Configuration",
    create_workspace_vnet: "Advanced: Network Configuration",
    create_workspace_resource_group: "Advanced: Network Configuration",
    existing_resource_group_name: "Advanced: Network Configuration",
    cmk_enabled: "Advanced: Network Configuration",
    allowed_fqdns: "Advanced: Network Configuration",
    workspace_vnet: "Advanced: Network Configuration",
    existing_workspace_vnet: "Advanced: Network Configuration",
    existing_hub_vnet: "Advanced: Network Configuration",
    existing_cmk_ids: "Advanced: Network Configuration",
    databricks_metastore_id: "Advanced: Network Configuration",
    existing_ncc_id: "Advanced: Network Configuration",
    existing_network_policy_id: "Advanced: Network Configuration",
    existing_ncc_name: "Advanced: Network Configuration",
    // SRA: AWS network fields
    network_configuration: "Advanced: Network Configuration",
    privatelink_subnets_cidr: "Advanced: Network Configuration",
    custom_vpc_id: "Advanced: Network Configuration",
    custom_private_subnet_ids: "Advanced: Network Configuration",
    custom_sg_id: "Advanced: Network Configuration",
    custom_relay_vpce_id: "Advanced: Network Configuration",
    custom_workspace_vpce_id: "Advanced: Network Configuration",

    // SRA: GCP network fields
    nodes_ip_cidr_range: "Advanced: Network Configuration",
    use_existing_vpc: "Advanced: Network Configuration",
    existing_vpc_name: "Advanced: Network Configuration",
    existing_subnet_name: "Advanced: Network Configuration",
    harden_network: "Security & Compliance",
    control_plane_ips: "Security & Compliance",
    // SRA: GCP PSC fields
    use_psc: "Advanced: Network Configuration",
    google_pe_subnet: "Advanced: Network Configuration",
    google_pe_subnet_ip_cidr_range: "Advanced: Network Configuration",
    workspace_pe: "Advanced: Network Configuration",
    relay_pe: "Advanced: Network Configuration",
    relay_pe_ip_name: "Advanced: Network Configuration",
    workspace_pe_ip_name: "Advanced: Network Configuration",
    relay_service_attachment: "Advanced: Network Configuration",
    workspace_service_attachment: "Advanced: Network Configuration",
    use_existing_PSC_EP: "Advanced: Network Configuration",
    use_existing_databricks_vpc_eps: "Advanced: Network Configuration",
    existing_databricks_vpc_ep_workspace: "Advanced: Network Configuration",
    existing_databricks_vpc_ep_relay: "Advanced: Network Configuration",
    use_existing_pas: "Advanced: Network Configuration",
    existing_pas_id: "Advanced: Network Configuration",
    // SRA: GCP metastore
    regional_metastore_id: "Additional Settings",

    // Security & Compliance
    enable_compliance_security_profile: "Security & Compliance",
    compliance_standards: "Security & Compliance",
    enable_security_analysis_tool: "Security & Compliance",
    cmk_admin_arn: "Security & Compliance",
    use_existing_cmek: "Security & Compliance",
    key_name: "Security & Compliance",
    keyring_name: "Security & Compliance",
    cmek_resource_id: "Security & Compliance",
    workspace_security_compliance: "Security & Compliance",

    // Metastore & Catalog
    metastore_exists: "Metastore & Catalog",
    existing_metastore_id: "Metastore & Catalog",
    uc_catalog_name: "Metastore & Catalog",

    // Additional Settings
    audit_log_delivery_exists: "Additional Settings",
    deployment_name: "Additional Settings",
    ip_addresses: "Additional Settings",
    account_console_url: "Additional Settings",
    sat_configuration: "Additional Settings",
    sat_service_principal: "Additional Settings",
  };

  // Azure SRA: split the mega network section into focused sub-sections
  if (templateId === "azure-sra") {
    const azureSraOverrides: Record<string, string> = {
      create_hub: "Hub Infrastructure",
      hub_vnet_cidr: "Hub Infrastructure",
      hub_resource_suffix: "Hub Infrastructure",
      existing_hub_vnet: "Hub Infrastructure",
      existing_ncc_id: "Hub Infrastructure",
      existing_ncc_name: "Hub Infrastructure",
      existing_network_policy_id: "Hub Infrastructure",

      create_workspace_vnet: "Workspace Network",
      workspace_vnet: "Workspace Network",
      existing_workspace_vnet: "Workspace Network",
      existing_resource_group_name: "Workspace",

      allowed_fqdns: "Firewall Rules",

      cmk_enabled: "Encryption",
      existing_cmk_ids: "Encryption",
    };
    Object.assign(sectionMap, azureSraOverrides);
  }

  // Build temporary map
  const tempSections: Record<string, TerraformVariable[]> = {};
  variables.forEach((v) => {
    const isExcluded = (EXCLUDE_VARIABLES as readonly string[]).includes(v.name);
    if (isExcluded && !(isGcpSra && SRA_UC_FIELDS.includes(v.name))) return;
    const section = sectionMap[v.name] || "Other Configuration";
    if (!tempSections[section]) tempSections[section] = [];
    tempSections[section].push(v);
  });

  // Return sections in canonical order with fields sorted
  const sections: Record<string, TerraformVariable[]> = {};
  for (const name of SECTION_ORDER) {
    if (tempSections[name]) {
      sections[name] = tempSections[name].sort(
        (a, b) => (FIELD_ORDER[a.name] ?? 99) - (FIELD_ORDER[b.name] ?? 99)
      );
    }
  }
  // Include any remaining sections not in SECTION_ORDER
  for (const [name, vars] of Object.entries(tempSections)) {
    if (!sections[name]) {
      sections[name] = vars.sort(
        (a, b) => (FIELD_ORDER[a.name] ?? 99) - (FIELD_ORDER[b.name] ?? 99)
      );
    }
  }
  return sections;
}

/**
 * Formats a variable name for display (converts snake_case to Title Case)
 */
export function formatVariableName(name: string): string {
  // Use constant display names if available
  if (VARIABLE_DISPLAY_NAMES[name]) {
    return VARIABLE_DISPLAY_NAMES[name];
  }
  
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Generates a random suffix for resource names
 */
export function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

interface FormDefaultsContext {
  azureUser?: string | null;
  gcpAccount?: string | null;
}

/**
 * Initializes form values with smart defaults for a set of Terraform variables.
 * Generates random suffixes for resource names and applies cloud-specific defaults.
 */
export function initializeFormDefaults(
  variables: TerraformVariable[],
  context: FormDefaultsContext = {}
): Record<string, any> {
  const defaults: Record<string, any> = {};
  const randomSuffix = generateRandomSuffix();
  const shortSuffix = randomSuffix.replace(/-/g, "").slice(0, DEFAULTS.SUFFIX_LENGTH);

  variables.forEach((v) => {
    if (v.name === "prefix") {
      const basePrefix = v.default || "databricks";
      defaults[v.name] = `${basePrefix}-${randomSuffix}`;
    } else if (v.name === "workspace_name" || v.name === "databricks_workspace_name") {
      defaults[v.name] = `databricks-ws-${randomSuffix}`;
    } else if (v.name === "root_storage_name") {
      defaults[v.name] = `dbstorage${shortSuffix}`;
    } else if (v.name === "subnet_public_cidr") {
      defaults[v.name] = DEFAULTS.PUBLIC_SUBNET_CIDR;
    } else if (v.name === "subnet_private_cidr") {
      defaults[v.name] = DEFAULTS.PRIVATE_SUBNET_CIDR;
    } else if (v.name === "private_subnet_1_cidr" || v.name === "private_subnet_2_cidr" || v.name === "public_subnet_cidr") {
      const vpcCidr = variables.find(x => x.name === "cidr_block")?.default || "10.4.0.0/16";
      const awsSubnets = computeAwsSubnets(vpcCidr);
      if (awsSubnets) {
        if (v.name === "private_subnet_1_cidr") defaults[v.name] = awsSubnets.private1Cidr;
        else if (v.name === "private_subnet_2_cidr") defaults[v.name] = awsSubnets.private2Cidr;
        else defaults[v.name] = awsSubnets.publicCidr;
      }
    } else if (v.name === "location" || v.name === "google_region" || v.name === "region") {
      defaults[v.name] = "";
    } else if (v.name === "workspace_sku") {
      defaults[v.name] = "premium";
    } else if (v.name === "admin_user" && context.azureUser) {
      defaults[v.name] = context.azureUser;
    } else if (v.name === "admin_user" && context.gcpAccount) {
      defaults[v.name] = context.gcpAccount;
    } else if (v.name === "create_new_resource_group" || v.name === "create_data_plane_resource_group") {
      defaults[v.name] = true;
    } else if (v.name === "vnet_name" || v.name === "vnet_resource_group_name") {
      defaults[v.name] = "";
    } else if (v.name === "resource_suffix") {
      defaults[v.name] = `sra${randomSuffix}`;
    } else if (v.name === "resource_prefix") {
      defaults[v.name] = `dbx${randomSuffix}`;
    } else if (v.name === "hub_resource_suffix") {
      defaults[v.name] = `hub${shortSuffix}`;
    } else if (["use_existing_cmek", "use_existing_pas", "metastore_exists", "audit_log_delivery_exists"].includes(v.name) && v.default === null) {
      defaults[v.name] = false;
    // --- AWS SRA defaults ---
    } else if (v.name === "vpc_cidr_range") {
      defaults[v.name] = "10.0.0.0/16";
    } else if (v.name === "sg_egress_ports") {
      defaults[v.name] = '["443", "3306", "6666", "8443", "8444", "8445", "8446", "8447", "8448", "8449", "8450", "8451"]';
    } else if (v.name === "network_configuration") {
      defaults[v.name] = "";
    } else if (v.name === "cmk_admin_arn") {
      defaults[v.name] = "";
    // --- Azure SRA defaults ---
    } else if (v.name === "hub_vnet_cidr") {
      defaults[v.name] = "10.100.0.0/20";
    // --- GCP SRA defaults ---
    } else if (v.name === "key_name") {
      defaults[v.name] = "sra-key";
    } else if (v.name === "keyring_name") {
      defaults[v.name] = "sra-keyring";
    } else if (v.name === "workspace_pe") {
      defaults[v.name] = "workspace-pe";
    } else if (v.name === "relay_pe") {
      defaults[v.name] = "relay-pe";
    } else if (v.name === "google_pe_subnet") {
      defaults[v.name] = "databricks-pe-subnet";
    } else if (v.name === "account_console_url") {
      defaults[v.name] = "https://accounts.gcp.databricks.com";
    } else if (v.name === "ip_addresses") {
      defaults[v.name] = '["0.0.0.0/0"]';
    } else if (v.name === "relay_pe_ip_name" || v.name === "workspace_pe_ip_name") {
      defaults[v.name] = "";
    } else if (v.name === "relay_service_attachment" || v.name === "workspace_service_attachment") {
      defaults[v.name] = "";
    } else if (v.name === "nodes_ip_cidr_range") {
      defaults[v.name] = "10.0.0.0/16";
    } else if (v.name === "google_pe_subnet_ip_cidr_range") {
      defaults[v.name] = "10.3.0.0/24";
    } else if (v.name === "regional_metastore_id") {
      defaults[v.name] = "";
    } else if (v.default !== null && v.default !== undefined) {
      const d = String(v.default).trim();
      const isComplexHcl = (d.startsWith("{") || d.startsWith("[")) && !isValidJson(d);
      const isTerraformNull = d === "null" || d.startsWith("null ");
      if (!isComplexHcl && !isTerraformNull) {
        defaults[v.name] = v.default;
      }
    } else {
      defaults[v.name] = "";
    }
  });

  // Pre-populate object decomposition sub-fields (not in variables list)
  if (!defaults["workspace_vnet__cidr"]) defaults["workspace_vnet__cidr"] = "10.0.0.0/20";
  if (!defaults["workspace_vnet__new_bits"]) defaults["workspace_vnet__new_bits"] = 2;

  // Pre-populate list decomposition sub-fields (AWS SRA subnets)
  if (!defaults["private_subnets_cidr_1"]) defaults["private_subnets_cidr_1"] = "10.0.0.0/18";
  if (!defaults["private_subnets_cidr_2"]) defaults["private_subnets_cidr_2"] = "10.0.64.0/18";
  if (!defaults["privatelink_subnets_cidr_1"]) defaults["privatelink_subnets_cidr_1"] = "10.0.128.0/28";
  if (!defaults["privatelink_subnets_cidr_2"]) defaults["privatelink_subnets_cidr_2"] = "10.0.128.16/28";

  // Pre-populate Azure PL subnet sub-fields from cidr_dp default
  if (defaults["cidr_dp"]) {
    const plSubnets = computeAzurePlSubnets(defaults["cidr_dp"]);
    if (plSubnets) {
      if (!defaults["subnet_workspace_cidrs_0"]) defaults["subnet_workspace_cidrs_0"] = plSubnets.publicCidr;
      if (!defaults["subnet_workspace_cidrs_1"]) defaults["subnet_workspace_cidrs_1"] = plSubnets.privateCidr;
      if (!defaults["subnet_private_endpoint_cidr"]) defaults["subnet_private_endpoint_cidr"] = plSubnets.privateEndpointCidr;
    }
  }

  return defaults;
}
