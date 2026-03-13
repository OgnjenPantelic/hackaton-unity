resource "databricks_mws_storage_configurations" "this" {
  provider                   = databricks.mws
  account_id                 = var.databricks_account_id
  storage_configuration_name = "${var.prefix}-storage"
  bucket_name                = aws_s3_bucket.root_storage_bucket.bucket
}

resource "databricks_mws_credentials" "this" {
  provider         = databricks.mws
  role_arn         = aws_iam_role.cross_account_role.arn
  credentials_name = "${var.prefix}-creds"
  depends_on       = [time_sleep.iam_propagation]
}

resource "databricks_mws_networks" "this" {
  provider           = databricks.mws
  account_id         = var.databricks_account_id
  network_name       = "${var.prefix}-network"
  security_group_ids = [local.security_group_id]
  subnet_ids         = local.subnet_ids
  vpc_id             = local.vpc_id
}

resource "databricks_mws_workspaces" "this" {
  provider                 = databricks.mws
  account_id               = var.databricks_account_id
  aws_region               = var.region
  workspace_name           = var.prefix
  credentials_id           = databricks_mws_credentials.this.credentials_id
  storage_configuration_id = databricks_mws_storage_configurations.this.storage_configuration_id
  network_id               = databricks_mws_networks.this.network_id
}

# Assign admin access to the workspace
data "databricks_user" "workspace_admin" {
  provider  = databricks.mws
  user_name = var.admin_user
}

resource "databricks_mws_permission_assignment" "workspace_admin" {
  provider     = databricks.mws
  workspace_id = databricks_mws_workspaces.this.workspace_id
  principal_id = data.databricks_user.workspace_admin.id
  permissions  = ["ADMIN"]
  depends_on   = [databricks_metastore_assignment.this]
}
