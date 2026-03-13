export const CLOUDS = {
  AWS: "aws",
  AZURE: "azure",
  GCP: "gcp",
} as const;

export const CLOUD_DISPLAY_NAMES: Record<string, string> = {
  [CLOUDS.AWS]: "AWS",
  [CLOUDS.AZURE]: "Azure",
  [CLOUDS.GCP]: "GCP",
};

export const AWS_REGIONS: { value: string; label: string }[] = [
  // North America
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "ca-central-1", label: "Canada (Central)" },
  // South America
  { value: "sa-east-1", label: "South America (São Paulo)" },
  // Europe
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "eu-west-2", label: "Europe (London)" },
  { value: "eu-west-3", label: "Europe (Paris)" },
  // Asia Pacific
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { value: "ap-southeast-3", label: "Asia Pacific (Jakarta)" },
];

export const AZURE_REGIONS: { value: string; label: string }[] = [
  // North America
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "westus", label: "West US" },
  { value: "westus2", label: "West US 2" },
  { value: "westus3", label: "West US 3" },
  { value: "centralus", label: "Central US" },
  { value: "northcentralus", label: "North Central US" },
  { value: "southcentralus", label: "South Central US" },
  { value: "canadacentral", label: "Canada Central" },
  { value: "canadaeast", label: "Canada East" },
  // South America
  { value: "brazilsouth", label: "Brazil South" },
  { value: "mexicocentral", label: "Mexico Central" },
  // Europe
  { value: "northeurope", label: "North Europe (Ireland)" },
  { value: "westeurope", label: "West Europe (Netherlands)" },
  { value: "uksouth", label: "UK South" },
  { value: "ukwest", label: "UK West" },
  { value: "francecentral", label: "France Central" },
  { value: "germanywestcentral", label: "Germany West Central" },
  { value: "swedencentral", label: "Sweden Central" },
  { value: "norwayeast", label: "Norway East" },
  { value: "switzerlandnorth", label: "Switzerland North" },
  // Asia Pacific
  { value: "australiaeast", label: "Australia East" },
  { value: "australiasoutheast", label: "Australia Southeast" },
  { value: "australiacentral", label: "Australia Central" },
  { value: "japaneast", label: "Japan East" },
  { value: "japanwest", label: "Japan West" },
  { value: "koreacentral", label: "Korea Central" },
  { value: "eastasia", label: "East Asia (Hong Kong)" },
  { value: "southeastasia", label: "Southeast Asia (Singapore)" },
  { value: "centralindia", label: "Central India" },
  { value: "southindia", label: "South India" },
  // Middle East
  { value: "qatarcentral", label: "Qatar Central" },
  { value: "uaenorth", label: "UAE North" },
];

export const GCP_REGIONS: { value: string; label: string }[] = [
  // North America
  { value: "us-central1", label: "US Central (Iowa)" },
  { value: "us-east1", label: "US East (South Carolina)" },
  { value: "us-east4", label: "US East (N. Virginia)" },
  { value: "us-west1", label: "US West (Oregon)" },
  { value: "us-west2", label: "US West (Los Angeles)" },
  { value: "us-west3", label: "US West (Salt Lake City)" },
  { value: "us-west4", label: "US West (Las Vegas)" },
  { value: "northamerica-northeast1", label: "Canada (Montreal)" },
  { value: "northamerica-northeast2", label: "Canada (Toronto)" },
  // South America
  { value: "southamerica-east1", label: "South America (São Paulo)" },
  { value: "southamerica-west1", label: "South America (Santiago)" },
  // Europe
  { value: "europe-west1", label: "Europe (Belgium)" },
  { value: "europe-west2", label: "Europe (London)" },
  { value: "europe-west3", label: "Europe (Frankfurt)" },
  { value: "europe-west4", label: "Europe (Netherlands)" },
  { value: "europe-west6", label: "Europe (Zurich)" },
  { value: "europe-west9", label: "Europe (Paris)" },
  { value: "europe-north1", label: "Europe (Finland)" },
  { value: "europe-central2", label: "Europe (Warsaw)" },
  // Asia Pacific
  { value: "asia-east1", label: "Asia (Taiwan)" },
  { value: "asia-east2", label: "Asia (Hong Kong)" },
  { value: "asia-northeast1", label: "Asia (Tokyo)" },
  { value: "asia-northeast2", label: "Asia (Osaka)" },
  { value: "asia-northeast3", label: "Asia (Seoul)" },
  { value: "asia-south1", label: "Asia (Mumbai)" },
  { value: "asia-south2", label: "Asia (Delhi)" },
  { value: "asia-southeast1", label: "Asia (Singapore)" },
  { value: "asia-southeast2", label: "Asia (Jakarta)" },
  // Australia
  { value: "australia-southeast1", label: "Australia (Sydney)" },
  { value: "australia-southeast2", label: "Australia (Melbourne)" },
];
