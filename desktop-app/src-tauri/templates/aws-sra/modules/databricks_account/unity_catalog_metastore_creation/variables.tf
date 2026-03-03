variable "metastore_exists" {
  description = "If a metastore exists."
  type        = string
}

variable "region" {
  description = "AWS region code."
  type        = string
}

variable "existing_metastore_id" {
  description = "ID of an existing metastore. When provided, skips data source lookup by region."
  type        = string
  default     = ""
}