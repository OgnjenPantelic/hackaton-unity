# Troubleshooting

Common runtime issues and fixes. For developer build issues, see the main [README](../README.md#troubleshooting).

## Cloud CLI Issues

### Azure CLI not detected
Run `az login` in terminal first, then restart the app.

### AWS SSO session expired
Run `aws sso login --profile <profile>` to refresh.

### Azure identity validation fails
Run `az login` and verify you have Databricks Account Admin. Test with:
```bash
az account get-access-token --resource 2ff814a6-3304-4ab8-85cb-cd0e6f879c1d
```

## GCP Issues

### GCP ADC not working
Run `gcloud auth application-default login` in terminal, then restart the app. If using impersonation, ensure the service account exists and your user has the `Service Account Token Creator` role on it.

### GCP service account missing permissions
The app creates a custom role with the required permissions. If validation reports missing permissions, some (like `storage.buckets.setIamPolicy`) are bucket-level and cannot be validated at the project level — they are still present in the role.

### GCP destroy fails on VPC deletion
Databricks creates firewall rules in the VPC that are not managed by Terraform. Delete them manually with:
```bash
gcloud compute firewall-rules list --filter="network:<vpc-name>" --format="value(name)" | xargs -I {} gcloud compute firewall-rules delete {} --quiet
```
Then re-run destroy.

## Unity Catalog

### Unity Catalog permissions error
Ensure your identity has metastore admin or the required grants (`CREATE CATALOG`, `CREATE EXTERNAL LOCATION`) on the existing metastore.

## AI Assistant

See [ai-assistant.md](ai-assistant.md#troubleshooting) for AI Assistant-specific issues.
