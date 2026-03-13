# GCP Databricks Workspace - Customer-managed VPC

Terraform template for deploying a Databricks workspace on GCP with a customer-managed VPC.

## What Gets Deployed

- Databricks Workspace with customer-managed VPC (BYOVPC)
- VPC with subnet in the specified region
- Cloud Router and Cloud NAT (auto-allocated IPs)
- Admin user added to the workspace
- Unity Catalog resources (optional): metastore, catalog, storage credential, external location

## Prerequisites

- Terraform CLI
- Google Cloud CLI (`gcloud auth application-default login`)
- Databricks account admin privileges (CLI profile or service account)

## Usage

This template is designed to be used via the Databricks Deployer desktop app.

For manual deployment:

```bash
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

## Variables

| Variable | Description |
|----------|-------------|
| `databricks_account_id` | Databricks account ID |
| `google_service_account_email` | Email of the Google service account |
| `google_project_name` | GCP project ID |
| `google_region` | GCP region (e.g. `us-central1`) |
| `databricks_workspace_name` | Name for the Databricks workspace |
| `admin_user` | Admin user email to add to the workspace |
| `subnet_cidr` | CIDR block for the Databricks subnet |
| `gcp_auth_method` | Auth method (`adc` or `service-account-key`) |
| `create_unity_catalog` | Enable Unity Catalog provisioning |
| `existing_metastore_id` | Existing metastore ID (skips metastore creation) |
| `uc_catalog_name` | Unity Catalog catalog name |
| `uc_storage_name` | Unity Catalog storage name |
| `tags` | Resource tags |

## Security Notes

- Don't commit `terraform.tfstate` or `terraform.tfvars` with secrets
- Use remote state for team collaboration
- Ensure the service account has the required GCP permissions (Compute, Service Networking, IAM, Storage)
