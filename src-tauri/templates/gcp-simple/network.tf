data "google_client_openid_userinfo" "me" {}
data "google_client_config" "current" {}

# Random suffix for unique resource naming
resource "random_string" "databricks_suffix" {
  special = false
  upper   = false
  length  = 3
}

######################################################
# Google VPC, Subnet, Router, NAT
######################################################
resource "google_compute_network" "databricks_vpc" {
  project                 = var.google_project_name
  name                    = "databricks-vpc-${random_string.databricks_suffix.result}"
  auto_create_subnetworks = false

  # Databricks auto-creates firewall rules on this VPC during workspace
  # provisioning (e.g. db-*-ingress) but doesn't remove them on deletion
  # (7-day soft-delete). Delete all firewall rules on this VPC before
  # destroying it, since it's a dedicated Databricks VPC.
  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      echo "Cleaning up firewall rules on VPC ${self.name}..."
      
      # Try to list all firewall rules on this VPC (capture exit code)
      if rules=$(gcloud compute firewall-rules list \
        --project="${self.project}" \
        --format="value(name)" \
        --filter="network:${self.name}" 2>/dev/null); then
        
        # Successfully listed rules
        if [ -z "$rules" ]; then
          echo "No firewall rules found on VPC ${self.name}."
        else
          # Delete each listed rule (non-fatal failures)
          echo "$rules" | while IFS= read -r rule; do
            if [ -n "$rule" ]; then
              echo "Deleting firewall rule: $rule"
              if gcloud compute firewall-rules delete "$rule" \
                --quiet \
                --project="${self.project}" 2>&1; then
                echo "Successfully deleted: $rule"
              else
                echo "Warning: Could not delete $rule (may already be deleted)"
              fi
            fi
          done
        fi
      else
        # List command failed (e.g., missing compute.firewalls.list permission)
        echo "Warning: Could not list firewall rules (permission denied or error)."
        echo "Attempting to delete known Databricks firewall rule patterns by name..."
        
        # Extract suffix from VPC name (e.g., "databricks-vpc-6l0" -> "6l0")
        suffix=$(echo "${self.name}" | sed 's/^databricks-vpc-//')
        
        # Try known Databricks-created firewall rule name patterns directly.
        # No list calls here since the list permission is what failed.
        for rule_name in \
          "db-databricks-subnet-$${suffix}-ingress" \
          "databricks-$${suffix}-ingress"; do
          echo "Attempting to delete: $rule_name"
          if gcloud compute firewall-rules delete "$rule_name" \
            --quiet \
            --project="${self.project}" 2>/dev/null; then
            echo "Successfully deleted $rule_name"
          else
            echo "Rule $rule_name not found or already deleted."
          fi
        done
      fi
      
      echo "Firewall cleanup complete."
    EOT
  }
}

resource "google_compute_subnetwork" "databricks_subnet" {
  name          = "databricks-subnet-${random_string.databricks_suffix.result}"
  ip_cidr_range = var.subnet_cidr
  region        = var.google_region
  network       = google_compute_network.databricks_vpc.id
}

resource "google_compute_router" "databricks_router" {
  name    = "databricks-router-${random_string.databricks_suffix.result}"
  region  = var.google_region
  network = google_compute_network.databricks_vpc.id
}

resource "google_compute_router_nat" "databricks_nat" {
  name                               = "databricks-nat-${random_string.databricks_suffix.result}"
  router                             = google_compute_router.databricks_router.name
  region                             = var.google_region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}


