# Terraform Documentation: https://registry.terraform.io/providers/databricks/databricks/latest/docs/guides/unity-catalog

resource "databricks_metastore" "this" {
  count         = var.metastore_exists ? 0 : 1
  name          = "${var.region}-unity-catalog"
  region        = var.region
  force_destroy = true
}