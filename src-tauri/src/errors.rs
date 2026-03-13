//! Standardized error message helpers.
//!
//! Centralises user-facing error strings so that wording stays consistent
//! across all cloud providers and CLI interactions.

/// CLI tool not found on the system.
pub fn cli_not_found(cli_name: &str) -> String {
    format!("{} not found. Please install it first.", cli_name)
}

/// Authentication session expired and needs renewal.
pub fn auth_expired(provider: &str) -> String {
    format!("{} session expired. Please login again.", provider)
}

/// User is not logged in to the given provider.
pub fn not_logged_in(provider: &str) -> String {
    format!("Not logged in to {}. Please login first.", provider)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_not_found_message() {
        let msg = cli_not_found("Terraform");
        assert_eq!(msg, "Terraform not found. Please install it first.");
    }

    #[test]
    fn cli_not_found_databricks() {
        let msg = cli_not_found("Databricks CLI");
        assert!(msg.contains("Databricks CLI"));
        assert!(msg.contains("install"));
    }

    #[test]
    fn auth_expired_message() {
        let msg = auth_expired("AWS");
        assert_eq!(msg, "AWS session expired. Please login again.");
    }

    #[test]
    fn auth_expired_azure() {
        let msg = auth_expired("Azure");
        assert!(msg.contains("Azure"));
        assert!(msg.contains("expired"));
    }

    #[test]
    fn not_logged_in_message() {
        let msg = not_logged_in("Azure");
        assert_eq!(msg, "Not logged in to Azure. Please login first.");
    }

    #[test]
    fn not_logged_in_gcp() {
        let msg = not_logged_in("GCP");
        assert!(msg.contains("GCP"));
        assert!(msg.contains("login"));
    }
}
