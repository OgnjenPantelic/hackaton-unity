# Azure Databricks Workspace - VNet Injected

Terraform template for deploying a Databricks workspace on Azure with secure networking.

## What Gets Deployed

- Databricks Workspace with VNet injection
- Virtual Network with private/public subnets (or use existing VNet)
- Network Security Groups
- NAT Gateway
- Resource Group (or use existing)
- Unity Catalog resources (optional): metastore, catalog, storage credential, external location

## Prerequisites

- Terraform CLI
- Azure CLI (`az login`)
- Databricks account admin privileges (CLI profile, service principal, or Azure CLI identity)

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
| `tenant_id` | Azure AD tenant ID |
| `azure_subscription_id` | Azure subscription ID |
| `workspace_name` | Workspace name |
| `admin_user` | Admin user email to add to the workspace |
| `location` | Azure region |
| `resource_group_name` | Resource group name |
| `create_new_resource_group` | Create a new resource group or use existing |
| `create_new_vnet` | Create a new VNet or use existing |
| `cidr` | VNet CIDR block |
| `workspace_sku` | Databricks workspace SKU (premium/trial) |
| `create_unity_catalog` | Enable Unity Catalog provisioning |
| `existing_metastore_id` | Existing metastore ID (skips metastore creation) |
| `uc_catalog_name` | Unity Catalog catalog name |
| `uc_storage_name` | Unity Catalog storage name |
| `databricks_auth_type` | Auth type (profile, service-principal, or azure-cli) |
| `tags` | Resource tags |
| `workspace_url_override` | Internal: placeholder URL for auto-import (auto-managed, do not set manually) |

## Security Notes

- Don't commit `terraform.tfstate` or `terraform.tfvars` with secrets
- Use remote state for team collaboration
- Ensure Contributor or Owner role on subscription
