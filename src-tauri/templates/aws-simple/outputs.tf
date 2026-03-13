output "workspace_url" {
  description = "Databricks workspace URL"
  value       = databricks_mws_workspaces.this.workspace_url
}

output "workspace_id" {
  description = "Databricks workspace ID"
  value       = databricks_mws_workspaces.this.workspace_id
}

output "vpc_id" {
  description = "VPC ID"
  value       = local.vpc_id
}

output "root_s3_bucket" {
  description = "Root storage S3 bucket"
  value       = aws_s3_bucket.root_storage_bucket.bucket
}

output "cross_account_role_arn" {
  description = "Cross-account IAM role ARN"
  value       = aws_iam_role.cross_account_role.arn
}

output "metastore_id" {
  description = "Unity Catalog metastore ID assigned to workspace"
  value       = databricks_metastore_assignment.this.metastore_id
}

output "metastore_status" {
  description = "Whether an existing metastore was used or a new one was created"
  value       = local.use_existing_metastore ? "Used existing metastore in region ${var.region}" : "Created new metastore: ${local.auto_metastore_name}"
}
