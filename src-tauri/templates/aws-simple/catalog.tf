# Unity Catalog with Isolated Storage
# Creates a catalog with dedicated S3 bucket, IAM role, storage credential, and external location
# This provides workspace-isolated data storage (recommended)

# Only create resources if Unity Catalog is enabled
locals {
  create_uc = var.create_unity_catalog && var.uc_catalog_name != "" && var.uc_storage_name != ""
  
  # IAM role name for Unity Catalog
  uc_iam_role_name = local.create_uc ? "${var.uc_catalog_name}-uc-role" : ""
  
  # Get AWS account ID from the current caller identity
  aws_account_id = data.aws_caller_identity.current.account_id
}

# Get current AWS account ID
data "aws_caller_identity" "current" {}

# Wait for IAM propagation (AWS IAM changes take time to propagate)
resource "time_sleep" "uc_iam_propagation" {
  count           = local.create_uc ? 1 : 0
  create_duration = "60s"
  depends_on      = [aws_iam_role_policy_attachment.uc_role_attachment]
}

# S3 Bucket for catalog storage
resource "aws_s3_bucket" "uc_catalog" {
  count         = local.create_uc ? 1 : 0
  bucket        = var.uc_storage_name
  force_destroy = var.uc_force_destroy
  
  tags = merge(var.tags, {
    Name    = "${var.uc_catalog_name}-catalog-storage"
    Purpose = "Unity Catalog Storage"
  })
}

resource "aws_s3_bucket_versioning" "uc_catalog" {
  count  = local.create_uc ? 1 : 0
  bucket = aws_s3_bucket.uc_catalog[0].id
  
  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_public_access_block" "uc_catalog" {
  count                   = local.create_uc ? 1 : 0
  bucket                  = aws_s3_bucket.uc_catalog[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Storage Credential - created before IAM role to get external_id
resource "databricks_storage_credential" "uc_credential" {
  count = local.create_uc ? 1 : 0
  
  provider = databricks.workspace
  name     = "${var.uc_catalog_name}-storage-credential"
  
  aws_iam_role {
    role_arn = "arn:aws:iam::${local.aws_account_id}:role/${local.uc_iam_role_name}"
  }
  
  comment    = "Storage credential for ${var.uc_catalog_name} catalog - managed by Terraform"
  depends_on = [databricks_metastore_assignment.this]
}

# Unity Catalog Trust Policy
data "databricks_aws_unity_catalog_assume_role_policy" "uc_policy" {
  count = local.create_uc ? 1 : 0
  
  aws_account_id        = local.aws_account_id
  aws_partition         = "aws"
  role_name             = local.uc_iam_role_name
  unity_catalog_iam_arn = "arn:aws:iam::414351767826:role/unity-catalog-prod-UCMasterRole-14S5ZJVKOTYTL"
  external_id           = databricks_storage_credential.uc_credential[0].aws_iam_role[0].external_id
}

# Unity Catalog S3 Access Policy
data "databricks_aws_unity_catalog_policy" "uc_policy" {
  count = local.create_uc ? 1 : 0
  
  aws_account_id = local.aws_account_id
  aws_partition  = "aws"
  bucket_name    = var.uc_storage_name
  role_name      = local.uc_iam_role_name
}

# IAM Policy for Unity Catalog S3 access
resource "aws_iam_policy" "uc_policy" {
  count = local.create_uc ? 1 : 0
  
  name   = "${var.uc_catalog_name}-uc-policy"
  policy = data.databricks_aws_unity_catalog_policy.uc_policy[0].json
  
  tags = var.tags
}

# IAM Role for Unity Catalog
resource "aws_iam_role" "uc_role" {
  count = local.create_uc ? 1 : 0
  
  name               = local.uc_iam_role_name
  assume_role_policy = data.databricks_aws_unity_catalog_assume_role_policy.uc_policy[0].json
  
  tags = merge(var.tags, {
    Name    = local.uc_iam_role_name
    Purpose = "Unity Catalog Access"
  })
}

# Attach policy to role
resource "aws_iam_role_policy_attachment" "uc_role_attachment" {
  count = local.create_uc ? 1 : 0
  
  role       = aws_iam_role.uc_role[0].name
  policy_arn = aws_iam_policy.uc_policy[0].arn
}

# External Location
resource "databricks_external_location" "uc_location" {
  count = local.create_uc ? 1 : 0
  
  provider        = databricks.workspace
  name            = "${var.uc_catalog_name}-location"
  url             = "s3://${aws_s3_bucket.uc_catalog[0].id}"
  credential_name = databricks_storage_credential.uc_credential[0].name
  comment         = "External location for ${var.uc_catalog_name} catalog - managed by Terraform"
  
  depends_on = [
    aws_iam_role_policy_attachment.uc_role_attachment,
    time_sleep.uc_iam_propagation
  ]
}

# Unity Catalog
resource "databricks_catalog" "uc_catalog" {
  count = local.create_uc ? 1 : 0
  
  provider     = databricks.workspace
  name         = var.uc_catalog_name
  storage_root = databricks_external_location.uc_location[0].url
  comment      = "Catalog with isolated storage - managed by Terraform"
  
  depends_on = [databricks_external_location.uc_location]
}

# Grant catalog ownership to admin user
resource "databricks_grant" "uc_catalog_owner" {
  count = local.create_uc ? 1 : 0
  
  provider  = databricks.workspace
  catalog   = databricks_catalog.uc_catalog[0].name
  principal = var.admin_user
  privileges = ["ALL_PRIVILEGES"]
}
