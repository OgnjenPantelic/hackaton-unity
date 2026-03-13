resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

resource "aws_s3_bucket" "root_storage_bucket" {
  bucket        = "${var.prefix}-root-${random_string.bucket_suffix.result}"
  force_destroy = true
  tags          = merge(var.tags, { Name = "${var.prefix}-root-storage" })
}

data "databricks_aws_bucket_policy" "this" {
  provider                 = databricks.mws
  databricks_e2_account_id = var.databricks_account_id
  bucket                   = aws_s3_bucket.root_storage_bucket.bucket
}

resource "aws_s3_bucket_policy" "root_bucket_policy" {
  bucket = aws_s3_bucket.root_storage_bucket.id
  policy = data.databricks_aws_bucket_policy.this.json
}
