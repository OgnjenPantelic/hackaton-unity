# AWS credentials via environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
provider "aws" {
  region = var.region
  default_tags {
    tags = merge(var.tags, { Project = var.prefix })
  }
}

# Databricks account provider
# auth_type is set dynamically:
# - "oauth-m2m" for service principal credentials
# - "databricks-cli" for CLI profile authentication
provider "databricks" {
  alias      = "mws"
  host       = "https://accounts.cloud.databricks.com"
  account_id = var.databricks_account_id
  auth_type  = var.databricks_auth_type
}

provider "databricks" {
  alias      = "workspace"
  host       = databricks_mws_workspaces.this.workspace_url
  account_id = var.databricks_account_id
}
