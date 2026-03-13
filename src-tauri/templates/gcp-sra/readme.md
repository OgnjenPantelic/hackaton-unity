# GCP Security Reference Architecture

Enterprise-grade Databricks deployment on GCP with Private Service Connect, CMEK encryption, and hardened firewall rules.

## What Gets Deployed

1. **GCP Networking:** VPC, subnets, Cloud Router, Cloud NAT, hardened firewall rules
2. **Private Service Connect (PSC):** Private endpoints for workspace and SCC relay communication
3. **CMEK:** Customer-managed encryption keys via Cloud KMS
4. **Databricks Workspace:** With private access settings and PSC connectivity
5. **Unity Catalog:** Metastore assignment and data governance
6. **Service Account:** Custom IAM role with least-privilege permissions

## Modules

| Module | Description |
|--------|-------------|
| `workspace_deployment` | VPC, PSC endpoints, CMEK, firewall, workspace provisioning ([README](modules/workspace_deployment/readme.md)) |
| `unity_catalog` | Metastore, storage credentials, external locations, cluster policy |
| `service_account` | GCP service account creation with custom IAM role and key management |
| `make_sa_dbx_admin` | Adds a service account as Databricks account admin ([README](modules/make_sa_dbx_admin/readme.md)) |

## Prerequisites

- **Google Service Account (GSA):** An existing GSA with the required permissions. [See required permissions.](https://docs.databricks.com/gcp/en/admin/cloud-configurations/gcp/permissions)
- **Databricks Admin Role:** The GSA must be assigned as a Databricks account admin.
- **Authenticated Session:** Logged in via `gcloud auth` or `GOOGLE_SERVICE_CREDENTIALS` environment variable.

## Usage

This template is designed to be used via the Databricks Deployer desktop app.

For manual deployment:

```bash
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

## Security Notes

- Don't commit `terraform.tfstate` or `terraform.tfvars` with secrets
- Use remote state for team collaboration
- The template supports using existing VPCs, PSC endpoints, and CMEK keys via `use_existing_*` flags
