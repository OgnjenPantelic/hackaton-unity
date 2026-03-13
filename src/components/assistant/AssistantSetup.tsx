import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAssistantContext } from "../../context/AssistantContext";
import { ASSISTANT_PROVIDERS } from "../../constants";

type ProviderKey = keyof typeof ASSISTANT_PROVIDERS;

export const AssistantSetup: React.FC = () => {
  const { saveToken, reconnect, loading, error, clearError, settings } = useAssistantContext();
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | null>(null);
  const [apiKey, setApiKey] = useState("");

  const handleProviderSelect = (provider: ProviderKey) => {
    setSelectedProvider(provider);
    clearError();
    setApiKey("");
  };

  const handleBack = () => {
    setSelectedProvider(null);
    setApiKey("");
    clearError();
  };

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProvider || !apiKey.trim()) return;
    await saveToken(selectedProvider, apiKey.trim());
  };

  const handleReconnect = async () => {
    if (!selectedProvider) return;
    await reconnect(selectedProvider);
  };

  const handleGetApiKey = () => {
    if (!selectedProvider) return;
    const url = ASSISTANT_PROVIDERS[selectedProvider].apiKeyUrl;
    invoke("open_url", { url }).catch(() => {});
  };

  // Provider selection screen
  if (!selectedProvider) {
    return (
      <div className="assistant-setup">
        <div className="assistant-setup-icon">✨</div>
        <h3>AI Assistant</h3>
        <p className="assistant-setup-description">
          Get contextual help about each step, Databricks concepts, cloud setup, and troubleshooting.
        </p>
        <p className="assistant-setup-hint">
          Choose a provider to connect your API key. Your connection goes directly to the provider.
        </p>

        <div className="assistant-provider-cards">
          {(Object.keys(ASSISTANT_PROVIDERS) as ProviderKey[]).map((key) => {
            const provider = ASSISTANT_PROVIDERS[key];
            return (
              <button
                key={key}
                className={`assistant-provider-card ${provider.recommended ? "recommended" : ""}`}
                onClick={() => handleProviderSelect(key)}
              >
                {provider.recommended && (
                  <span className="assistant-provider-badge">Recommended</span>
                )}
                <div className="assistant-provider-name">{provider.name}</div>
                <div className="assistant-provider-description">{provider.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // API key input screen
  const provider = ASSISTANT_PROVIDERS[selectedProvider];

  const hasExistingKey = settings && (
    (selectedProvider === "github-models" && settings.has_github_key) ||
    (selectedProvider === "openai" && settings.has_openai_key) ||
    (selectedProvider === "claude" && settings.has_claude_key)
  );

  return (
    <div className="assistant-setup">
      <div className="assistant-setup-icon">🔑</div>
      <h3>{provider.name}</h3>
      <p className="assistant-setup-description">{provider.instructions}</p>

      <button
        className="btn btn-secondary assistant-get-key-btn"
        onClick={handleGetApiKey}
      >
        Get API Key
      </button>

      {hasExistingKey && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
          <div style={{
            padding: "12px",
            backgroundColor: "rgba(78, 201, 176, 0.1)",
            borderRadius: "6px",
            border: "1px solid rgba(78, 201, 176, 0.3)",
            textAlign: "center"
          }}>
            <p style={{ fontSize: "13px", color: "#4ec9b0", margin: 0 }}>
              ✓ Key already saved for this provider
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleReconnect}
            disabled={loading}
            style={{ width: "100%" }}
          >
            {loading && !apiKey.trim() ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span className="spinner" style={{ width: 14, height: 14 }} />
                Reconnecting...
              </span>
            ) : (
              "Reconnect"
            )}
          </button>

          <div style={{
            textAlign: "center",
            fontSize: "12px",
            color: "#666",
            position: "relative"
          }}>
            <span style={{
              backgroundColor: "#1b1b1d",
              padding: "0 8px",
              position: "relative",
              zIndex: 1
            }}>
              Or enter a new key to replace it
            </span>
            <div style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: "1px",
              backgroundColor: "#35353a",
              zIndex: 0
            }} />
          </div>
        </div>
      )}

      <form onSubmit={handleConnect} style={{ width: "100%" }}>
        <div className="assistant-api-key-input">
          <label htmlFor="api-key">{hasExistingKey ? "Or New API Key" : "API Key"}</label>
          <input
            id="api-key"
            type="password"
            placeholder={provider.apiKeyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={loading}
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="assistant-setup-error">
            <span>{error}</span>
            <button type="button" onClick={clearError} className="assistant-setup-error-dismiss">✕</button>
          </div>
        )}

        <div className="assistant-setup-actions">
          <button
            type="button"
            className="btn btn-link"
            onClick={handleBack}
            disabled={loading}
          >
            ← Back
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !apiKey.trim()}
          >
            {loading && apiKey.trim() ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span className="spinner" style={{ width: 14, height: 14 }} />
                Connecting...
              </span>
            ) : (
              hasExistingKey ? "Connect with New Key" : "Connect"
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
