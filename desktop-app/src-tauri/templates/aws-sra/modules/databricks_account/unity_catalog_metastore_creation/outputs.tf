output "metastore_id" {
  description = "Metastore ID."
  value       = var.metastore_exists ? var.existing_metastore_id : databricks_metastore.this[0].id
}