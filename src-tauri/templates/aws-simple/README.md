# AWS Databricks Workspace - BYOVPC

Terraform template for deploying a Databricks workspace on AWS with customer-managed VPC.

## What Gets Deployed

- Databricks Workspace with BYOVPC
- VPC with private/public subnets across AZs (or use existing VPC)
- Security Groups
- NAT Gateways
- IAM Roles and Policies (cross-account credential)
- S3 Root Storage Bucket (encrypted)
- Unity Catalog resources (optional): metastore, catalog, storage credential, external location

## Prerequisites

- Terraform CLI
- AWS CLI (`aws configure` or SSO)
- Databricks account admin privileges (CLI profile or service principal)

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
| `admin_user` | Admin user email to add to the workspace |
| `prefix` | Resource name prefix |
| `region` | AWS region |
| `cidr_block` | VPC CIDR block |
| `create_new_vpc` | Create a new VPC or use existing |
| `existing_vpc_id` | Existing VPC ID (when `create_new_vpc` = false) |
| `existing_subnet_ids` | Existing subnet IDs (when `create_new_vpc` = false) |
| `existing_security_group_id` | Existing SG ID (when `create_new_vpc` = false) |
| `create_unity_catalog` | Enable Unity Catalog provisioning |
| `existing_metastore_id` | Existing metastore ID (skips metastore creation) |
| `uc_catalog_name` | Unity Catalog catalog name |
| `uc_storage_name` | Unity Catalog storage name |
| `tags` | Resource tags |

## Security Notes

- Don't commit `terraform.tfstate` or `terraform.tfvars` with secrets
- Use S3 + DynamoDB for remote state
- Ensure IAM permissions to create VPCs, IAM roles, S3 buckets
