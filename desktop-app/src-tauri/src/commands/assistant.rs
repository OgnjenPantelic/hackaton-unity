//! AI assistant commands — Multi-provider LLM integration.
//!
//! Supports GitHub Models (free), OpenAI, and Claude via API keys.
//! The user provides their own API key, which is encrypted at rest using AES-256-GCM.

use aes_gcm::aead::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use super::debug_log;

// ─── Static Knowledge Base ──────────────────────────────────────────────────

/// Embedded at compile time from resources/assistant-knowledge.md.
const KNOWLEDGE_BASE: &str = include_str!("../../resources/assistant-knowledge.md");

/// Parsed knowledge base sections, initialized once on first access.
static KNOWLEDGE_SECTIONS: OnceLock<HashMap<String, String>> = OnceLock::new();

// ─── Provider Configuration ─────────────────────────────────────────────────

/// Supported LLM providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum LlmProvider {
    GithubModels,
    Openai,
    Claude,
}

impl Default for LlmProvider {
    fn default() -> Self {
        LlmProvider::GithubModels
    }
}

/// Parse a provider string (e.g. "github-models") into an `LlmProvider` enum.
fn parse_provider(provider: &str) -> Result<LlmProvider, String> {
    serde_json::from_str(&format!("\"{}\"", provider))
        .map_err(|_| format!("Unknown provider: {}", provider))
}

// ─── Types ──────────────────────────────────────────────────────────────────

/// Chat message exchanged between user and assistant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Persisted assistant settings.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AssistantSettings {
    pub active_provider: LlmProvider,
    pub configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_api_key: Option<String>,
    pub github_model: Option<String>,
    pub cached_models: Option<Vec<(String, String)>>,
    pub models_cache_timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_history: Option<Vec<ChatMessage>>,
}

/// Response struct for assistant_get_settings that includes computed has_*_key flags.
#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    #[serde(flatten)]
    settings: AssistantSettings,
    has_github_key: bool,
    has_openai_key: bool,
    has_claude_key: bool,
}

/// OpenAI-compatible chat completion response (used by GitHub Models and OpenAI).
#[derive(Debug, Deserialize)]
struct CompletionResponse {
    choices: Vec<CompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct CompletionChoice {
    message: CompletionMessage,
}

#[derive(Debug, Deserialize)]
struct CompletionMessage {
    content: String,
}

/// Claude API message response.
#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContent {
    text: String,
}

/// OpenAI error response for parsing detailed error messages.
#[derive(Debug, Deserialize)]
struct OpenAIError {
    error: OpenAIErrorDetail,
}

#[derive(Debug, Deserialize)]
struct OpenAIErrorDetail {
    message: String,
}

/// GitHub Models catalog model entry.
#[derive(Debug, Deserialize)]
struct CatalogModel {
    id: String,
    name: String,
    #[serde(default)]
    publisher: Option<String>,
}

// ─── GitHub Models List ─────────────────────────────────────────────────────

/// Cache duration for fetched models (24 hours).
const MODELS_CACHE_DURATION_SECS: u64 = 86400;

// ─── Helpers ────────────────────────────────────────────────────────────────

// ─── Encryption Helpers ─────────────────────────────────────────────────────

/// Get the encryption key file path.
fn get_keyfile_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("assistant-keyfile"))
}

/// Get or create the encryption key for API keys.
fn get_or_create_encryption_key(app: &AppHandle) -> Result<[u8; 32], String> {
    let keyfile_path = get_keyfile_path(app)?;
    
    if keyfile_path.exists() {
        let key_bytes = fs::read(&keyfile_path).map_err(|e| e.to_string())?;
        if key_bytes.len() != 32 {
            return Err("Corrupted encryption key file".to_string());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes);
        Ok(key)
    } else {
        // Generate a new 256-bit key
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        fs::write(&keyfile_path, &key).map_err(|e| format!("Failed to save encryption key: {}", e))?;
        Ok(key)
    }
}

fn encrypt_key(plaintext: &str, enc_key: &[u8; 32]) -> Result<String, String> {
    crate::crypto::encrypt(plaintext, enc_key)
}

fn decrypt_key(encrypted: &str, enc_key: &[u8; 32]) -> Result<String, String> {
    crate::crypto::decrypt(encrypted, enc_key)
}

fn is_encrypted(value: &str) -> bool {
    crate::crypto::is_encrypted(value)
}

// ─── File I/O Helpers ───────────────────────────────────────────────────────

/// Create an HTTP client with timeout and required headers.
fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent("DatabricksDeployer/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// Resolve the assistant settings file path.
fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("assistant-settings.json"))
}

/// Load settings from disk, returning defaults if file doesn't exist.
/// Automatically migrates plaintext keys to encrypted format on first load.
fn load_settings(app: &AppHandle) -> Result<AssistantSettings, String> {
    let path = get_settings_path(app)?;
    if !path.exists() {
        return Ok(AssistantSettings::default());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut settings: AssistantSettings = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse assistant settings: {}", e))?;
    
    // Migrate plaintext keys to encrypted format
    let enc_key = get_or_create_encryption_key(app)?;
    let mut needs_save = false;
    
    if let Some(ref key) = settings.github_api_key {
        if !is_encrypted(key) {
            settings.github_api_key = Some(encrypt_key(key, &enc_key)?);
            needs_save = true;
        }
    }
    
    if let Some(ref key) = settings.openai_api_key {
        if !is_encrypted(key) {
            settings.openai_api_key = Some(encrypt_key(key, &enc_key)?);
            needs_save = true;
        }
    }
    
    if let Some(ref key) = settings.claude_api_key {
        if !is_encrypted(key) {
            settings.claude_api_key = Some(encrypt_key(key, &enc_key)?);
            needs_save = true;
        }
    }
    
    // Save migrated settings
    if needs_save {
        save_settings_to_disk(app, &settings)?;
    }
    
    Ok(settings)
}

/// Save settings to disk.
fn save_settings_to_disk(app: &AppHandle, settings: &AssistantSettings) -> Result<(), String> {
    let path = get_settings_path(app)?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to save settings: {}", e))
}

// ─── Token Budget Constants ──────────────────────────────────────────────────

const MAX_RESPONSE_TOKENS: usize = 1024;
const GITHUB_MODELS_INPUT_BUDGET: usize = 8000 - MAX_RESPONSE_TOKENS;
const OPENAI_INPUT_BUDGET: usize = 15000;
const CLAUDE_INPUT_BUDGET: usize = 15000;

/// Rough token estimate: ~4 chars per token for English text.
fn estimate_tokens(text: &str) -> usize {
    text.len() / 4
}

/// Return the input token budget for a given provider.
fn input_budget_for_provider(provider: &LlmProvider) -> usize {
    match provider {
        LlmProvider::GithubModels => GITHUB_MODELS_INPUT_BUDGET,
        LlmProvider::Openai => OPENAI_INPUT_BUDGET,
        LlmProvider::Claude => CLAUDE_INPUT_BUDGET,
    }
}

// ─── Knowledge Base Section Parsing ─────────────────────────────────────────

const SECTION_MARKER_PREFIX: &str = "<!-- section: ";
const SECTION_MARKER_SUFFIX: &str = " -->";

/// Parse KNOWLEDGE_BASE into named sections delimited by `<!-- section: name -->`.
fn parse_knowledge_sections() -> HashMap<String, String> {
    let mut sections = HashMap::new();
    let mut current_section = String::new();
    let mut current_content = String::new();

    for line in KNOWLEDGE_BASE.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(SECTION_MARKER_PREFIX) {
            if let Some(name) = rest.strip_suffix(SECTION_MARKER_SUFFIX) {
                if !current_section.is_empty() || !current_content.is_empty() {
                    let key = if current_section.is_empty() { "core".to_string() } else { current_section };
                    sections.insert(key, current_content.trim().to_string());
                }
                current_section = name.to_string();
                current_content = String::new();
                continue;
            }
        }
        current_content.push_str(line);
        current_content.push('\n');
    }

    if !current_section.is_empty() || !current_content.is_empty() {
        let key = if current_section.is_empty() { "core".to_string() } else { current_section };
        sections.insert(key, current_content.trim().to_string());
    }

    sections
}

/// Get the parsed knowledge sections (initialized once).
fn get_knowledge_sections() -> &'static HashMap<String, String> {
    KNOWLEDGE_SECTIONS.get_or_init(parse_knowledge_sections)
}

/// Map a screen name to the additional knowledge sections it needs beyond core.
fn sections_for_screen(screen: &str) -> &'static [&'static str] {
    match screen {
        "aws-credentials" | "azure-credentials" | "gcp-credentials" => &["cloud-auth"],
        "databricks-credentials" => &["databricks-auth"],
        "template-selection" | "configuration" => &["templates"],
        "unity-catalog-config" => &["unity-catalog"],
        "deployment" => &["deployment"],
        _ => &[],
    }
}

/// Assemble the system prompt from core + screen-relevant knowledge sections.
/// Falls back to the full KNOWLEDGE_BASE if section markers are missing.
fn build_system_prompt(screen: &str, screen_context: &str, state_metadata: &str) -> String {
    let sections = get_knowledge_sections();

    let knowledge = if sections.contains_key("core") {
        let mut parts = Vec::new();
        if let Some(core) = sections.get("core") {
            parts.push(core.as_str());
        }
        for section_name in sections_for_screen(screen) {
            if let Some(content) = sections.get(*section_name) {
                parts.push(content.as_str());
            }
        }
        parts.join("\n\n")
    } else {
        debug_log!("[assistant] Warning: knowledge base section markers not found, using full content");
        KNOWLEDGE_BASE.to_string()
    };

    let mut prompt = String::with_capacity(knowledge.len() + 512);
    prompt.push_str(&knowledge);
    prompt.push_str("\n\n# Current Screen Context\n\n");
    prompt.push_str(screen_context);
    if !state_metadata.is_empty() {
        prompt.push_str("\n\n# Current App State\n\n");
        prompt.push_str(state_metadata);
    }
    prompt
}

/// Truncate history to fit within the remaining token budget.
/// Keeps the most recent messages, dropping oldest first.
fn truncate_history_to_budget(
    history: &[ChatMessage],
    system_prompt_tokens: usize,
    user_message_tokens: usize,
    total_budget: usize,
) -> Vec<ChatMessage> {
    let fixed_tokens = system_prompt_tokens + user_message_tokens;
    if fixed_tokens >= total_budget {
        debug_log!(
            "[assistant] System prompt ({}) + user message ({}) already exceeds budget ({}), sending with no history",
            system_prompt_tokens, user_message_tokens, total_budget
        );
        return Vec::new();
    }

    let mut remaining = total_budget - fixed_tokens;
    let mut kept: Vec<ChatMessage> = Vec::new();

    for msg in history.iter().rev() {
        let msg_tokens = estimate_tokens(&msg.content) + 4; // +4 for role/message overhead
        if msg_tokens > remaining {
            break;
        }
        remaining -= msg_tokens;
        kept.push(msg.clone());
    }

    kept.reverse();
    kept
}

/// Validate an API key by making a test request to the provider's API.
async fn validate_api_key(
    provider: &LlmProvider,
    api_key: &str,
    client: &reqwest::Client,
) -> Result<(), String> {
    match provider {
        LlmProvider::GithubModels => {
            let response = client
                .post("https://models.github.ai/inference/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .json(&serde_json::json!({
                    "model": "openai/gpt-4o-mini",
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to validate GitHub token: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                
                if status.as_u16() == 429 {
                    return Err("Rate limit reached. Please wait a moment and try again.".to_string());
                }
                
                if status.as_u16() == 403 || status.as_u16() == 401 {
                    return Err("GitHub token is invalid or missing 'models:read' permission. Please create a Fine-grained Personal Access Token with Account permissions → Models → Read-only access.".to_string());
                }
                
                return Err(format!("Invalid GitHub token ({}): {}", status, body));
            }
            Ok(())
        }
        LlmProvider::Openai => {
            let response = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to validate OpenAI token: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                
                if status.as_u16() == 429 {
                    if let Ok(error_response) = serde_json::from_str::<OpenAIError>(&body) {
                        return Err(error_response.error.message);
                    }
                    return Err("Rate limit reached. Please wait a moment and try again.".to_string());
                }
                
                return Err(format!("Invalid OpenAI API key ({}): {}", status, body));
            }
            Ok(())
        }
        LlmProvider::Claude => {
            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "model": "claude-3-5-haiku-latest",
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to validate Claude token: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                
                if status.as_u16() == 429 {
                    return Err("Rate limit reached. Please wait a moment and try again.".to_string());
                }
                
                return Err(format!("Invalid Claude API key ({}): {}", status, body));
            }
            Ok(())
        }
    }
}

/// Call an OpenAI-compatible chat completions API (GitHub Models or OpenAI).
async fn call_openai_compatible(
    url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    message: &str,
    history: &[ChatMessage],
    client: &reqwest::Client,
    provider_name: &str,
) -> Result<String, String> {
    // Build messages array: system prompt + history + new user message
    let mut messages: Vec<serde_json::Value> = Vec::with_capacity(history.len() + 2);

    messages.push(serde_json::json!({
        "role": "system",
        "content": system_prompt,
    }));

    for msg in history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": message,
    }));

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.05,
        "max_tokens": 1024,
    });

    let mut request = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json");

    // GitHub Models requires additional headers
    if provider_name == "GitHub Models" {
        request = request
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to call {} API: {}", provider_name, e))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();

        if status.as_u16() == 429 {
            // Try to parse OpenAI's detailed error message for OpenAI provider
            if provider_name == "OpenAI" || provider_name == "GitHub Models" {
                if let Ok(error_response) = serde_json::from_str::<OpenAIError>(&body) {
                    return Err(error_response.error.message);
                }
            }
            return Err("Rate limit reached. Please wait a moment and try again.".to_string());
        }

        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(format!("{} token expired or invalid. Please disconnect and reconnect.", provider_name));
        }

        return Err(format!("{} API error ({}): {}", provider_name, status, body));
    }

    let completion: CompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let reply = completion
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .unwrap_or_else(|| "No response from the assistant.".to_string());

    Ok(reply)
}

/// Call the Claude API for chat completions.
async fn call_claude(
    api_key: &str,
    system_prompt: &str,
    message: &str,
    history: &[ChatMessage],
    client: &reqwest::Client,
) -> Result<String, String> {
    // Claude uses a different message format - system is separate
    let mut claude_messages: Vec<serde_json::Value> = Vec::with_capacity(history.len() + 1);

    for msg in history {
        claude_messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    claude_messages.push(serde_json::json!({
        "role": "user",
        "content": message,
    }));

    let body = serde_json::json!({
        "model": "claude-3-5-haiku-latest",
        "system": system_prompt,
        "messages": claude_messages,
        "temperature": 0.05,
        "max_tokens": 1024,
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to call Claude API: {}", e))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();

        if status.as_u16() == 429 {
            return Err("Rate limit reached. Please wait a moment and try again.".to_string());
        }

        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err("Claude API key expired or invalid. Please disconnect and reconnect.".to_string());
        }

        return Err(format!("Claude API error ({}): {}", status, body));
    }

    let claude_response: ClaudeResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let reply = claude_response
        .content
        .first()
        .map(|c| c.text.clone())
        .unwrap_or_else(|| "No response from the assistant.".to_string());

    Ok(reply)
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Save an API key for the specified provider.
///
/// Validates the key by making a lightweight test request to the provider's API.
#[tauri::command]
pub async fn assistant_save_token(
    provider: String,
    api_key: String,
    app: AppHandle,
) -> Result<(), String> {
    let provider_enum = parse_provider(&provider)?;

    // Validate the API key by making a simple test request
    let client = http_client(15)?;
    validate_api_key(&provider_enum, &api_key, &client).await?;

    // Load existing settings to preserve cache and model selection
    let mut settings = load_settings(&app).unwrap_or_default();
    
    // Only clear cache if switching providers
    let switching_providers = settings.active_provider != provider_enum;
    
    settings.active_provider = provider_enum.clone();
    settings.configured = true;
    
    // Encrypt the API key before saving
    let enc_key = get_or_create_encryption_key(&app)?;
    let encrypted_key = encrypt_key(&api_key, &enc_key)?;
    
    // Save to provider-specific field
    match provider_enum {
        LlmProvider::GithubModels => settings.github_api_key = Some(encrypted_key),
        LlmProvider::Openai => settings.openai_api_key = Some(encrypted_key),
        LlmProvider::Claude => settings.claude_api_key = Some(encrypted_key),
    }
    
    // Clear provider-specific data only when switching
    if switching_providers {
        settings.github_model = None;
        settings.cached_models = None;
        settings.models_cache_timestamp = None;
    }
    
    save_settings_to_disk(&app, &settings)?;
    Ok(())
}

/// Send a message to the AI assistant and get a response.
///
/// Assembles the system prompt from the knowledge base (scoped to the current screen),
/// screen context, and state metadata, then calls the appropriate provider's API.
/// History is truncated to fit within the provider's token budget.
#[tauri::command]
pub async fn assistant_chat(
    message: String,
    screen: String,
    screen_context: String,
    state_metadata: String,
    history: Vec<ChatMessage>,
    app: AppHandle,
) -> Result<String, String> {
    let settings = load_settings(&app)?;

    let encrypted_key = match settings.active_provider {
        LlmProvider::GithubModels => settings.github_api_key,
        LlmProvider::Openai => settings.openai_api_key,
        LlmProvider::Claude => settings.claude_api_key,
    }.ok_or("Assistant not configured. Please connect your API key first.")?;
    
    // Decrypt the API key
    let enc_key = get_or_create_encryption_key(&app)?;
    let api_key = decrypt_key(&encrypted_key, &enc_key)?;

    let system_prompt = build_system_prompt(&screen, &screen_context, &state_metadata);
    let client = http_client(60)?;

    // Token-aware history truncation
    let budget = input_budget_for_provider(&settings.active_provider);
    let system_tokens = estimate_tokens(&system_prompt);
    let user_tokens = estimate_tokens(&message);
    let trimmed_history = truncate_history_to_budget(&history, system_tokens, user_tokens, budget);

    debug_log!(
        "[assistant] screen={}, provider={:?}, system_tokens={}, user_tokens={}, history={}/{} msgs, budget={}",
        screen, settings.active_provider, system_tokens, user_tokens,
        trimmed_history.len(), history.len(), budget
    );

    match settings.active_provider {
        LlmProvider::GithubModels => {
            let model = settings.github_model.as_deref().unwrap_or("openai/gpt-4o-mini");
            call_openai_compatible(
                "https://models.github.ai/inference/chat/completions",
                &api_key,
                model,
                &system_prompt,
                &message,
                &trimmed_history,
                &client,
                "GitHub Models",
            ).await
        }
        LlmProvider::Openai => {
            call_openai_compatible(
                "https://api.openai.com/v1/chat/completions",
                &api_key,
                "gpt-4o-mini",
                &system_prompt,
                &message,
                &trimmed_history,
                &client,
                "OpenAI",
            ).await
        }
        LlmProvider::Claude => {
            call_claude(
                &api_key,
                &system_prompt,
                &message,
                &trimmed_history,
                &client,
            ).await
        }
    }
}

/// Load saved assistant settings.
/// Returns settings with encrypted keys stripped and has_* booleans computed.
#[tauri::command]
pub fn assistant_get_settings(app: AppHandle) -> Result<SettingsResponse, String> {
    let mut settings = load_settings(&app)?;
    
    // Compute has_* booleans
    let has_github_key = settings.github_api_key.is_some();
    let has_openai_key = settings.openai_api_key.is_some();
    let has_claude_key = settings.claude_api_key.is_some();
    
    // Strip encrypted keys before sending to frontend
    settings.github_api_key = None;
    settings.openai_api_key = None;
    settings.claude_api_key = None;
    
    Ok(SettingsResponse {
        settings,
        has_github_key,
        has_openai_key,
        has_claude_key,
    })
}

/// Switch to a different provider without deleting keys.
#[tauri::command]
pub fn assistant_switch_provider(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(&app)?;
    settings.configured = false;
    settings.chat_history = None; // Clear chat history when switching
    save_settings_to_disk(&app, &settings)
}

/// Reconnect to a provider using an already-saved API key.
#[tauri::command]
pub fn assistant_reconnect(provider: String, app: AppHandle) -> Result<(), String> {
    let provider_enum = parse_provider(&provider)?;
    
    let mut settings = load_settings(&app)?;
    
    // Verify key exists for this provider
    let has_key = match provider_enum {
        LlmProvider::GithubModels => settings.github_api_key.is_some(),
        LlmProvider::Openai => settings.openai_api_key.is_some(),
        LlmProvider::Claude => settings.claude_api_key.is_some(),
    };
    
    if !has_key {
        return Err("No saved key for this provider.".to_string());
    }
    
    settings.active_provider = provider_enum;
    settings.configured = true;
    save_settings_to_disk(&app, &settings)
}

/// Delete the API key for a specific provider.
#[tauri::command]
pub fn assistant_delete_provider_key(provider: String, app: AppHandle) -> Result<(), String> {
    let provider_enum = parse_provider(&provider)?;
    
    let mut settings = load_settings(&app)?;
    
    match provider_enum {
        LlmProvider::GithubModels => {
            settings.github_api_key = None;
            settings.github_model = None;
            settings.cached_models = None;
            settings.models_cache_timestamp = None;
        },
        LlmProvider::Openai => settings.openai_api_key = None,
        LlmProvider::Claude => settings.claude_api_key = None,
    }
    
    // If deleting active provider, mark as unconfigured
    if settings.active_provider == provider_enum {
        settings.configured = false;
    }
    
    save_settings_to_disk(&app, &settings)
}

/// Delete all API keys and reset settings.
#[tauri::command]
pub fn assistant_delete_all_keys(app: AppHandle) -> Result<(), String> {
    let settings = AssistantSettings::default();
    save_settings_to_disk(&app, &settings)
}

/// Get available GitHub Models (fetches from API, caches for 24 hours).
#[tauri::command]
pub async fn assistant_get_available_models(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    let mut settings = load_settings(&app)?;
    
    // Check if cache is valid (exists and not expired)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System clock error".to_string())?
        .as_secs();
    
    let cache_valid = settings.cached_models.is_some() 
        && settings.models_cache_timestamp
            .map(|ts| now - ts < MODELS_CACHE_DURATION_SECS)
            .unwrap_or(false);
    
    if cache_valid {
        if let Some(models) = settings.cached_models {
            return Ok(models);
        }
    }
    
    // Fetch from API
    let encrypted_token = settings.github_api_key.as_ref()
        .ok_or("No GitHub API key available")?;
    
    // Decrypt the token
    let enc_key = get_or_create_encryption_key(&app)?;
    let token = decrypt_key(encrypted_token, &enc_key)?;
    
    let client = http_client(15)?;
    let response = client
        .get("https://models.github.ai/catalog/models")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models catalog: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to fetch models catalog ({}): {}", status, body));
    }
    
    let models: Vec<CatalogModel> = response.json().await
        .map_err(|e| format!("Failed to parse models catalog: {}", e))?;
    
    // Convert to (id, display_name) tuples
    let model_list: Vec<(String, String)> = models
        .into_iter()
        .map(|m| {
            let display = if let Some(pub_name) = m.publisher {
                format!("{} ({})", m.name, pub_name)
            } else {
                m.name
            };
            (m.id, display)
        })
        .collect();
    
    // Cache in settings
    settings.cached_models = Some(model_list.clone());
    settings.models_cache_timestamp = Some(now);
    save_settings_to_disk(&app, &settings)?;
    
    Ok(model_list)
}

/// Update the selected GitHub Model.
#[tauri::command]
pub fn assistant_update_model(model: String, app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(&app)?;
    settings.github_model = Some(model);
    save_settings_to_disk(&app, &settings)
}

/// Save chat history to disk.
#[tauri::command]
pub fn assistant_save_history(messages: Vec<ChatMessage>, app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(&app)?;
    settings.chat_history = Some(messages);
    save_settings_to_disk(&app, &settings)
}

/// Clear chat history from disk.
#[tauri::command]
pub fn assistant_clear_history(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(&app)?;
    settings.chat_history = None;
    save_settings_to_disk(&app, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    // ── parse_provider ──────────────────────────────────────────────────

    #[test]
    fn parse_provider_github_models() {
        let p = parse_provider("github-models").unwrap();
        assert_eq!(p, LlmProvider::GithubModels);
    }

    #[test]
    fn parse_provider_openai() {
        let p = parse_provider("openai").unwrap();
        assert_eq!(p, LlmProvider::Openai);
    }

    #[test]
    fn parse_provider_claude() {
        let p = parse_provider("claude").unwrap();
        assert_eq!(p, LlmProvider::Claude);
    }

    #[test]
    fn parse_provider_unknown() {
        assert!(parse_provider("llama").is_err());
    }

    #[test]
    fn parse_provider_empty() {
        assert!(parse_provider("").is_err());
    }

    // ── is_encrypted ────────────────────────────────────────────────────

    #[test]
    fn is_encrypted_true() {
        assert!(is_encrypted("enc:v1:somebase64data"));
    }

    #[test]
    fn is_encrypted_false_plain_key() {
        assert!(!is_encrypted("sk-1234567890abcdef"));
    }

    #[test]
    fn is_encrypted_false_empty() {
        assert!(!is_encrypted(""));
    }

    #[test]
    fn is_encrypted_false_partial_prefix() {
        assert!(!is_encrypted("enc:v2:data"));
    }

    // ── encrypt_key / decrypt_key round-trip ────────────────────────────

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = [42u8; 32];
        let plaintext = "sk-test-api-key-1234567890";
        let encrypted = encrypt_key(plaintext, &key).unwrap();
        assert!(encrypted.starts_with("enc:v1:"));
        let decrypted = decrypt_key(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_produces_different_ciphertexts() {
        let key = [7u8; 32];
        let plaintext = "same-key";
        let enc1 = encrypt_key(plaintext, &key).unwrap();
        let enc2 = encrypt_key(plaintext, &key).unwrap();
        assert_ne!(enc1, enc2, "random nonce should produce different ciphertexts");
        assert_eq!(decrypt_key(&enc1, &key).unwrap(), plaintext);
        assert_eq!(decrypt_key(&enc2, &key).unwrap(), plaintext);
    }

    #[test]
    fn decrypt_wrong_key_fails() {
        let key1 = [1u8; 32];
        let key2 = [2u8; 32];
        let encrypted = encrypt_key("secret", &key1).unwrap();
        assert!(decrypt_key(&encrypted, &key2).is_err());
    }

    #[test]
    fn decrypt_invalid_prefix_fails() {
        let key = [0u8; 32];
        assert!(decrypt_key("not-encrypted", &key).is_err());
    }

    #[test]
    fn decrypt_invalid_base64_fails() {
        let key = [0u8; 32];
        assert!(decrypt_key("enc:v1:not-valid-base64!!!", &key).is_err());
    }

    #[test]
    fn decrypt_too_short_fails() {
        let key = [0u8; 32];
        let short = format!("enc:v1:{}", base64::engine::general_purpose::STANDARD.encode(&[0u8; 5]));
        assert!(decrypt_key(&short, &key).is_err());
    }

    // ── knowledge section parsing ──────────────────────────────────────

    #[test]
    fn parse_knowledge_sections_has_core() {
        let sections = parse_knowledge_sections();
        assert!(sections.contains_key("core"), "core section must exist");
        assert!(sections.get("core").unwrap().contains("What This App Does"));
    }

    #[test]
    fn parse_knowledge_sections_has_all_expected_sections() {
        let sections = parse_knowledge_sections();
        for name in &["core", "cloud-auth", "databricks-auth", "templates", "unity-catalog", "deployment"] {
            assert!(sections.contains_key(*name), "missing section: {}", name);
            assert!(!sections.get(*name).unwrap().is_empty(), "section {} is empty", name);
        }
    }

    #[test]
    fn parse_knowledge_sections_no_marker_leaks() {
        let sections = parse_knowledge_sections();
        for (name, content) in &sections {
            assert!(
                !content.contains("<!-- section:"),
                "section {} leaks marker comments into content", name
            );
        }
    }

    // ── sections_for_screen ─────────────────────────────────────────────

    #[test]
    fn sections_for_screen_credential_screens() {
        assert_eq!(sections_for_screen("aws-credentials"), &["cloud-auth"]);
        assert_eq!(sections_for_screen("azure-credentials"), &["cloud-auth"]);
        assert_eq!(sections_for_screen("gcp-credentials"), &["cloud-auth"]);
    }

    #[test]
    fn sections_for_screen_databricks_credentials() {
        assert_eq!(sections_for_screen("databricks-credentials"), &["databricks-auth"]);
    }

    #[test]
    fn sections_for_screen_template_screens() {
        assert_eq!(sections_for_screen("template-selection"), &["templates"]);
        assert_eq!(sections_for_screen("configuration"), &["templates"]);
    }

    #[test]
    fn sections_for_screen_unity_catalog() {
        assert_eq!(sections_for_screen("unity-catalog-config"), &["unity-catalog"]);
    }

    #[test]
    fn sections_for_screen_deployment() {
        assert_eq!(sections_for_screen("deployment"), &["deployment"]);
    }

    #[test]
    fn sections_for_screen_unknown_returns_empty() {
        assert!(sections_for_screen("welcome").is_empty());
        assert!(sections_for_screen("cloud-selection").is_empty());
        assert!(sections_for_screen("dependencies").is_empty());
        assert!(sections_for_screen("nonexistent").is_empty());
    }

    // ── build_system_prompt ─────────────────────────────────────────────

    #[test]
    fn build_system_prompt_always_includes_core() {
        let prompt = build_system_prompt("welcome", "ctx", "");
        assert!(prompt.contains("What This App Does"));
        assert!(prompt.contains("Common Issues"));
    }

    #[test]
    fn build_system_prompt_welcome_excludes_detailed_templates() {
        let prompt = build_system_prompt("welcome", "ctx", "");
        assert!(!prompt.contains("## AWS Standard BYOVPC"), "detailed templates should not appear on welcome");
    }

    #[test]
    fn build_system_prompt_configuration_includes_templates() {
        let prompt = build_system_prompt("configuration", "ctx", "");
        assert!(prompt.contains("## AWS Standard BYOVPC"));
        assert!(prompt.contains("## Azure Security Reference Architecture"));
    }

    #[test]
    fn build_system_prompt_includes_screen_context() {
        let prompt = build_system_prompt("welcome", "The user is on the welcome screen.", "");
        assert!(prompt.contains("# Current Screen Context"));
        assert!(prompt.contains("The user is on the welcome screen."));
    }

    #[test]
    fn build_system_prompt_includes_state_metadata() {
        let prompt = build_system_prompt("deployment", "ctx", "cloud=aws, template=aws-simple");
        assert!(prompt.contains("# Current App State"));
        assert!(prompt.contains("cloud=aws"));
    }

    #[test]
    fn build_system_prompt_omits_state_section_when_empty() {
        let prompt = build_system_prompt("welcome", "ctx", "");
        assert!(!prompt.contains("# Current App State"));
    }

    // ── estimate_tokens ─────────────────────────────────────────────────

    #[test]
    fn estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn estimate_tokens_short_text() {
        assert_eq!(estimate_tokens("hello world!"), 3);
    }

    #[test]
    fn estimate_tokens_longer_text() {
        let text = "a".repeat(400);
        assert_eq!(estimate_tokens(&text), 100);
    }

    // ── truncate_history_to_budget ──────────────────────────────────────

    #[test]
    fn truncate_history_keeps_all_when_budget_allows() {
        let history = vec![
            ChatMessage { role: "user".into(), content: "hi".into() },
            ChatMessage { role: "assistant".into(), content: "hello".into() },
        ];
        let result = truncate_history_to_budget(&history, 100, 10, 10000);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn truncate_history_drops_oldest_first() {
        let history = vec![
            ChatMessage { role: "user".into(), content: "a".repeat(400) },       // ~104 tokens
            ChatMessage { role: "assistant".into(), content: "b".repeat(400) },   // ~104 tokens
            ChatMessage { role: "user".into(), content: "recent".into() },        // ~5 tokens
        ];
        // Budget 130: system(100) + user(10) = 110 remaining = 20. Only "recent" (~5+4=9) fits.
        let result = truncate_history_to_budget(&history, 100, 10, 130);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "recent");
    }

    #[test]
    fn truncate_history_returns_empty_when_budget_exhausted_by_prompt() {
        let history = vec![
            ChatMessage { role: "user".into(), content: "hello".into() },
        ];
        let result = truncate_history_to_budget(&history, 5000, 100, 5000);
        assert!(result.is_empty());
    }

    #[test]
    fn truncate_history_empty_input() {
        let result = truncate_history_to_budget(&[], 100, 10, 10000);
        assert!(result.is_empty());
    }

    // ── LlmProvider default ─────────────────────────────────────────────

    #[test]
    fn llm_provider_default_is_github_models() {
        assert_eq!(LlmProvider::default(), LlmProvider::GithubModels);
    }

    // ── input_budget_for_provider ───────────────────────────────────────

    #[test]
    fn github_budget_is_smallest() {
        assert!(input_budget_for_provider(&LlmProvider::GithubModels) < input_budget_for_provider(&LlmProvider::Openai));
        assert!(input_budget_for_provider(&LlmProvider::GithubModels) < input_budget_for_provider(&LlmProvider::Claude));
    }
}
