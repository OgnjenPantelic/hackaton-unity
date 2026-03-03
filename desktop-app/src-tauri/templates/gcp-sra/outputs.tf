output "workspace_url" {
  description = "The URL of the Databricks workspace"
  value       = module.customer_managed_vpc.databricks_host
}
