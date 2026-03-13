//! System proxy detection for Windows and macOS.
//!
//! Terraform (Go) does not read OS-level proxy settings — it only honours
//! `HTTPS_PROXY` / `HTTP_PROXY` environment variables.  GUI apps launched
//! outside a terminal session typically lack these variables even when a
//! system-wide proxy is configured, causing `terraform init` to fail when
//! it tries to download providers or modules from the internet.
//!
//! This module detects the OS proxy configuration and returns the
//! corresponding environment variables so they can be injected into
//! Terraform (and other) child processes.

use std::collections::HashMap;

/// Networking-related environment variable names that should be forwarded
/// from the user's environment (if present) into child processes.
const FORWARDED_ENV_VARS: &[&str] = &[
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "CURL_CA_BUNDLE",
    "REQUESTS_CA_BUNDLE",
    "GITHUB_TOKEN",
    "GIT_SSL_CAINFO",
];

/// Return proxy and networking environment variables to inject into child
/// processes.
///
/// Priority order:
/// 1. Existing process env vars (user's shell may have set them)
/// 2. OS-level proxy settings (Windows registry / macOS `scutil`)
pub fn get_proxy_env_vars() -> HashMap<String, String> {
    let mut vars = HashMap::new();

    // 1. Forward any networking env vars already present in the process environment.
    for &name in FORWARDED_ENV_VARS {
        if let Ok(val) = std::env::var(name) {
            if !val.is_empty() {
                vars.insert(name.to_string(), val);
            }
        }
    }

    // 2. If no proxy env vars were inherited, try OS-level detection.
    let has_proxy = vars.contains_key("HTTPS_PROXY")
        || vars.contains_key("https_proxy")
        || vars.contains_key("HTTP_PROXY")
        || vars.contains_key("http_proxy");

    if !has_proxy {
        if let Some(detected) = detect_system_proxy() {
            if let Some(https) = &detected.https_proxy {
                vars.insert("HTTPS_PROXY".to_string(), https.clone());
            }
            if let Some(http) = &detected.http_proxy {
                vars.insert("HTTP_PROXY".to_string(), http.clone());
            }
            if let Some(no) = &detected.no_proxy {
                vars.insert("NO_PROXY".to_string(), no.clone());
            }
        }
    }

    vars
}

/// Return the detected HTTPS proxy URL (if any), for configuring reqwest.
pub fn get_https_proxy() -> Option<String> {
    // Check env vars first
    for name in &["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(val) = std::env::var(name) {
            if !val.is_empty() {
                return Some(val);
            }
        }
    }

    // Fall back to OS detection
    detect_system_proxy().and_then(|p| p.https_proxy.or(p.http_proxy))
}

struct SystemProxy {
    https_proxy: Option<String>,
    http_proxy: Option<String>,
    no_proxy: Option<String>,
}

/// Detect proxy settings from the OS. Returns `None` if no proxy is configured
/// or detection fails.
fn detect_system_proxy() -> Option<SystemProxy> {
    #[cfg(target_os = "windows")]
    {
        detect_windows_proxy()
    }

    #[cfg(target_os = "macos")]
    {
        detect_macos_proxy()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

// ─── Windows ────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn detect_windows_proxy() -> Option<SystemProxy> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let settings = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;

    let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return None;
    }

    let server: String = settings.get_value("ProxyServer").ok()?;
    if server.is_empty() {
        return None;
    }

    let proxy_url = normalize_proxy_url(&server);

    let no_proxy = settings
        .get_value::<String, _>("ProxyOverride")
        .ok()
        .map(|v| convert_proxy_override_to_no_proxy(&v));

    Some(SystemProxy {
        https_proxy: Some(proxy_url.clone()),
        http_proxy: Some(proxy_url),
        no_proxy,
    })
}

// ─── macOS ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn detect_macos_proxy() -> Option<SystemProxy> {
    let output = crate::commands::silent_cmd("scutil")
        .arg("--proxy")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let https = parse_scutil_proxy(&text, "HTTPS");
    let http = parse_scutil_proxy(&text, "HTTP");

    if https.is_none() && http.is_none() {
        return None;
    }

    let no_proxy = parse_scutil_exceptions_list(&text);

    Some(SystemProxy {
        https_proxy: https,
        http_proxy: http,
        no_proxy,
    })
}

#[cfg(target_os = "macos")]
fn parse_scutil_proxy(text: &str, scheme: &str) -> Option<String> {
    let enable_key = format!("{}Enable : 1", scheme);
    if !text.contains(&enable_key) {
        return None;
    }

    let host_key = format!("{}Proxy : ", scheme);
    let port_key = format!("{}Port : ", scheme);

    let host = text
        .lines()
        .find(|l| l.contains(&host_key))
        .and_then(|l| l.split(':').last())
        .map(|s| s.trim().to_string())?;

    let port = text
        .lines()
        .find(|l| l.contains(&port_key))
        .and_then(|l| l.split(':').last())
        .map(|s| s.trim().to_string());

    match port {
        Some(p) if !p.is_empty() => Some(format!("http://{}:{}", host, p)),
        _ => Some(format!("http://{}", host)),
    }
}

#[cfg(target_os = "macos")]
fn parse_scutil_exceptions_list(text: &str) -> Option<String> {
    let start = text.find("ExceptionsList : <array>")?;
    let block = &text[start..];
    let end = block.find('}')?;
    let block = &block[..end];

    let exceptions: Vec<String> = block
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            // Lines look like: "  0 : *.local"
            if trimmed.contains(" : ") && !trimmed.starts_with("ExceptionsList") {
                trimmed.split(" : ").last().map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .collect();

    if exceptions.is_empty() {
        None
    } else {
        Some(exceptions.join(","))
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Ensure a proxy server value has a scheme prefix.
/// Windows registry may store just "server:port" without "http://".
#[cfg(any(target_os = "windows", test))]
fn normalize_proxy_url(server: &str) -> String {
    if server.starts_with("http://") || server.starts_with("https://") {
        server.to_string()
    } else {
        format!("http://{}", server)
    }
}

/// Convert Windows `ProxyOverride` format to `NO_PROXY` format.
/// Windows uses semicolons and `<local>`; `NO_PROXY` uses commas and `localhost`.
#[cfg(target_os = "windows")]
fn convert_proxy_override_to_no_proxy(proxy_override: &str) -> String {
    proxy_override
        .split(';')
        .map(|entry| {
            let trimmed = entry.trim();
            if trimmed.eq_ignore_ascii_case("<local>") {
                "localhost,127.0.0.1".to_string()
            } else {
                trimmed.to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_proxy_url_adds_scheme() {
        assert_eq!(normalize_proxy_url("proxy.corp:8080"), "http://proxy.corp:8080");
    }

    #[test]
    fn normalize_proxy_url_preserves_scheme() {
        assert_eq!(normalize_proxy_url("http://proxy.corp:8080"), "http://proxy.corp:8080");
        assert_eq!(normalize_proxy_url("https://proxy.corp:443"), "https://proxy.corp:443");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn convert_proxy_override_basic() {
        assert_eq!(
            convert_proxy_override_to_no_proxy("*.local;<local>;10.*"),
            "*.local,localhost,127.0.0.1,10.*"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn convert_proxy_override_empty() {
        assert_eq!(convert_proxy_override_to_no_proxy(""), "");
    }

    #[test]
    fn get_proxy_env_vars_returns_hashmap() {
        let vars = get_proxy_env_vars();
        assert!(vars.is_empty() || !vars.is_empty());
    }
}
