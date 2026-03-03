export interface CloudCredentials {
  // AWS
  aws_profile?: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  aws_session_token?: string;
  aws_region?: string;
  // Azure
  azure_tenant_id?: string;
  azure_subscription_id?: string;
  azure_client_id?: string;
  azure_client_secret?: string;
  azure_account_email?: string;
  azure_databricks_use_identity?: boolean;
  // GCP
  gcp_project_id?: string;
  gcp_credentials_json?: string;
  gcp_use_adc?: boolean;
  gcp_oauth_token?: string;
  gcp_service_account_email?: string;
  // Databricks
  databricks_account_id?: string;
  databricks_client_id?: string;
  databricks_client_secret?: string;
  databricks_profile?: string;
  databricks_auth_type?: string;
  // Cloud identifier
  cloud?: string;
}

export interface AwsProfile {
  name: string;
  is_sso: boolean;
}

export interface AwsIdentity {
  account: string;
  arn: string;
  user_id: string;
}

export interface AzureSubscription {
  id: string;
  name: string;
  is_default: boolean;
  tenant_id: string;
}

export interface AzureAccount {
  user: string;
  tenant_id: string;
  subscription_id: string;
  subscription_name: string;
}

export interface GcpValidation {
  valid: boolean;
  project_id: string | null;
  account: string | null;
  message: string;
  oauth_token: string | null;
  impersonated_account: string | null;
}

export interface AzureVnet {
  name: string;
  resource_group: string;
  location: string;
  address_prefixes: string[];
}

export interface CloudPermissionCheck {
  has_all_permissions: boolean;
  checked_permissions: string[];
  missing_permissions: string[];
  message: string;
  is_warning: boolean;
}
