# Google Cloud Provider
# Authentication methods:
#   - Impersonation: GOOGLE_OAUTH_ACCESS_TOKEN from gcloud auth print-access-token
#   - Credentials: GOOGLE_CREDENTIALS or google_credentials_json with SA key JSON
provider "google" {
  project     = var.google_project_name
  region      = var.google_region
  credentials = var.gcp_auth_method == "credentials" ? var.google_credentials_json : null
}

# Databricks Account Provider
# Used for account-level operations: workspace creation, metastore management
# Authentication: 
#   - Impersonation: google_service_account + GOOGLE_OAUTH_ACCESS_TOKEN env var
#   - Credentials: google_credentials with SA JSON key content
provider "databricks" {
  alias      = "accounts"
  host       = "https://accounts.gcp.databricks.com"
  account_id = var.databricks_account_id
  # Use impersonation (SA email + GOOGLE_OAUTH_ACCESS_TOKEN) or credentials (JSON key)
  google_service_account = var.gcp_auth_method == "impersonation" ? var.google_service_account_email : null
  google_credentials     = var.gcp_auth_method == "credentials" ? var.google_credentials_json : null
}

# Databricks Workspace Provider
# Used for workspace-level operations: users, catalogs, storage credentials
# Created after workspace is provisioned
provider "databricks" {
  alias = "workspace"
  host  = databricks_mws_workspaces.databricks_workspace.workspace_url
  # Use impersonation (SA email + GOOGLE_OAUTH_ACCESS_TOKEN) or credentials (JSON key)
  google_service_account = var.gcp_auth_method == "impersonation" ? var.google_service_account_email : null
  google_credentials     = var.gcp_auth_method == "credentials" ? var.google_credentials_json : null
}

