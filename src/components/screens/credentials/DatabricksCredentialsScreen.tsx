import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloudCredentials, DatabricksProfile } from "../../../types";
import { CLOUDS } from "../../../constants";
import { Alert, PasswordInput } from "../../ui";
import { useWizard } from "../../../hooks/useWizard";
import { validateDatabricksCredentials } from "../../../utils/databricksValidation";

export function DatabricksCredentialsScreen() {
  const {
    credentials, setCredentials,
    selectedCloud, dependencies,
    error, setError,
    setScreen, goBack,
  } = useWizard();
  const onContinue = () => setScreen("template-selection");
  const onBack = goBack;
  const databricksCli = dependencies["databricks"];
  // Databricks auth state
  const [authMode, setAuthMode] = useState<"profile" | "credentials">(
    databricksCli?.installed ? "profile" : "credentials"
  );
  const [profiles, setProfiles] = useState<DatabricksProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAddSpProfileForm, setShowAddSpProfileForm] = useState(false);
  const [addSpProfileData, setAddSpProfileData] = useState({ 
    accountId: "", 
    clientId: "", 
    clientSecret: "" 
  });
  const [validatingCredentials, setValidatingCredentials] = useState(false);

  // Load profiles on mount
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const loadedProfiles = await invoke<DatabricksProfile[]>("get_databricks_profiles", { 
          cloud: selectedCloud 
        });
        setProfiles(loadedProfiles);
        if (loadedProfiles.length > 0 && !selectedProfile) {
          setSelectedProfile(loadedProfiles[0].name);
          loadProfileCredentials(loadedProfiles[0].name);
        }
      } catch {
        // Ignore profile loading errors
      }
    };
    loadProfiles();
  }, [selectedCloud]);

  const handleCredentialChange = (key: keyof CloudCredentials, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const loadProfileCredentials = async (profileName: string) => {
    try {
      setLoading(true);
      setAuthError(null);
      const profileCreds = await invoke<Record<string, string>>("get_databricks_profile_credentials", { 
        profileName 
      });
      
      setCredentials(prev => ({
        ...prev,
        databricks_account_id: profileCreds.account_id || prev.databricks_account_id,
        databricks_client_id: profileCreds.client_id || "",
        databricks_client_secret: profileCreds.client_secret || "",
      }));
    } catch (e) {
      setAuthError(`Failed to load profile: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSpProfile = async () => {
    const { accountId, clientId, clientSecret } = addSpProfileData;
    
    if (!accountId.trim() || !clientId.trim() || !clientSecret.trim()) {
      setAuthError("All fields are required");
      return;
    }
    
    setLoading(true);
    setAuthError(null);
    
    try {
      // Validate the credentials first
      await invoke("validate_databricks_credentials", {
        accountId,
        clientId,
        clientSecret,
        cloud: selectedCloud,
      });
      
      // Create the CLI profile
      const profileName = await invoke<string>("create_databricks_sp_profile", {
        cloud: selectedCloud,
        accountId,
        clientId,
        clientSecret,
      });
      
      // Refresh profiles list
      const newProfiles = await invoke<DatabricksProfile[]>("get_databricks_profiles", { 
        cloud: selectedCloud 
      });
      setProfiles(newProfiles);
      
      // Select the new profile
      setSelectedProfile(profileName);
      await loadProfileCredentials(profileName);
      
      // Close the form and reset
      setShowAddSpProfileForm(false);
      setAddSpProfileData({ accountId: "", clientId: "", clientSecret: "" });
    } catch (e) {
      setAuthError(`Failed to add profile: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const validateAndContinue = async () => {
    // Set auth type in credentials
    const updatedCredentials = {
      ...credentials,
      databricks_auth_type: authMode,
      databricks_profile: authMode === "profile" ? selectedProfile : undefined,
    };
    setCredentials(updatedCredentials);

    setError(null);
    setValidatingCredentials(true);

    try {
      await validateDatabricksCredentials({
        credentials: updatedCredentials,
        selectedCloud,
        authMode,
        selectedProfile,
        profiles,
      });

      setValidatingCredentials(false);
      onContinue();
    } catch (e: unknown) {
      setValidatingCredentials(false);
      setError(`Invalid Databricks credentials: ${String(e)}`);
    }
  };

  // Determine validation states
  const hasValidProfile = authMode === "profile" && selectedProfile && credentials.databricks_account_id;
  const hasValidCredentials = authMode === "credentials" &&
    credentials.databricks_account_id?.trim() && 
    credentials.databricks_client_id?.trim() && 
    credentials.databricks_client_secret?.trim();
  const gcpCanContinue = selectedCloud === CLOUDS.GCP && credentials.databricks_account_id?.trim();
  const canContinue = gcpCanContinue || hasValidProfile || hasValidCredentials;
  const showExistingProfiles = profiles.length > 0;

  // Simplified view for GCP - only needs Account ID
  if (selectedCloud === CLOUDS.GCP) {
    const isUsingServiceAccountKey = credentials.gcp_use_adc === false;
    
    return (
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <h1>Databricks Account</h1>
        <p className="subtitle">
          Enter your Databricks Account ID. Authentication will use your GCP service account credentials.
        </p>

        {error && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        {authError && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{authError}</Alert>}

        <div className="form-section">
          {isUsingServiceAccountKey ? (
            <Alert type="info" style={{ marginBottom: "20px" }}>
              <strong>Service account key mode:</strong> Your service account (<code>{credentials.gcp_service_account_email || "from JSON key"}</code>) will be validated for Databricks account access. Ensure it has been added to the{" "}
              <a href="https://accounts.gcp.databricks.com" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                Databricks Account Console
              </a>{" "}
              with account admin privileges.
            </Alert>
          ) : (
            <Alert type="info" style={{ marginBottom: "20px" }}>
              <strong>GCP authentication:</strong> Your GCP service account ({credentials.gcp_service_account_email || "configured in previous step"}) will be used to authenticate with Databricks. Make sure this service account has been added to your Databricks Account Console with account admin privileges.
            </Alert>
          )}

          <div className="form-group">
            <label>Databricks Account ID *</label>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={credentials.databricks_account_id || ""}
              onChange={(e) => handleCredentialChange("databricks_account_id", e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <div className="help-text">
              Found in{" "}
              <a href="https://accounts.gcp.databricks.com" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                Databricks Account Console
              </a>
              . Open your top-right user menu to find a copy button for your Account ID.
            </div>
          </div>
        </div>

        <div style={{ marginTop: "32px" }}>
          <button 
            className="btn" 
            onClick={validateAndContinue} 
            disabled={!canContinue || validatingCredentials}
          >
            {validatingCredentials ? (
              <>
                <span className="spinner" />
                Validating Credentials...
              </>
            ) : (
              "Validate & Continue →"
            )}
          </button>
        </div>
      </div>
    );
  }

  // Simplified view for Azure Identity mode - only needs Account ID
  if (selectedCloud === CLOUDS.AZURE && credentials.azure_databricks_use_identity) {
    return (
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <h1>Databricks Account</h1>
        <p className="subtitle">
          Enter your Databricks Account ID. Your Azure account will be used for authentication.
        </p>

        {error && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        {authError && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{authError}</Alert>}

        <div className="form-section">
          <Alert type="info" style={{ marginBottom: "20px" }}>
            <strong>Azure identity authentication:</strong> Your Azure account (<code>{credentials.azure_account_email}</code>) will be used to authenticate with Databricks. Ensure your account has been added to the{" "}
            <a href="https://accounts.azuredatabricks.net" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
              Databricks Account Console
            </a>{" "}
            with account admin privileges.
          </Alert>

          <div className="form-group">
            <label>Databricks Account ID *</label>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={credentials.databricks_account_id || ""}
              onChange={(e) => handleCredentialChange("databricks_account_id", e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <div className="help-text">
              Found in{" "}
              <a href="https://accounts.azuredatabricks.net" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                Databricks Account Console
              </a>
              . Open your top-right user menu to find a copy button for your Account ID.
            </div>
          </div>
        </div>

        <div style={{ marginTop: "32px" }}>
          <button 
            className="btn" 
            onClick={validateAndContinue} 
            disabled={!credentials.databricks_account_id?.trim() || validatingCredentials}
          >
            {validatingCredentials ? (
              <>
                <span className="spinner" />
                Validating Credentials...
              </>
            ) : (
              "Validate & Continue →"
            )}
          </button>
        </div>
      </div>
    );
  }

  // AWS/Azure full view
  return (
    <div className="container">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h1>Databricks Account</h1>
      <p className="subtitle">
        Configure your Databricks credentials for deploying resources. A service principal with account admin privileges is required.
      </p>

      {error && <Alert type="error">{error}</Alert>}
      {authError && <Alert type="error">{authError}</Alert>}

      <div className="form-section">
        <h3>Authentication Method</h3>
        
        <div className="auth-mode-selector">
          <label className="radio-label">
            <input
              type="radio"
              checked={authMode === "profile"}
              onChange={() => setAuthMode("profile")}
            />
            Use Databricks CLI Profile (recommended)
          </label>
          <label className="radio-label">
            <input
              type="radio"
              checked={authMode === "credentials"}
              onChange={() => setAuthMode("credentials")}
            />
            Use Service Principal Credentials
          </label>
        </div>

        {authMode === "profile" && (
          <>
            {!showAddSpProfileForm && (
              <>
                <div className="alert alert-info" style={{ marginTop: "16px", fontSize: "13px" }}>
                  <strong>Note:</strong> Only service principal profiles are supported. SSO profiles are tied to specific workspaces and won't work with newly created workspaces.
                </div>
                
                {showExistingProfiles ? (
                  <div className="form-group" style={{ marginTop: "16px" }}>
                    <label>Select Existing Profile</label>
                    <select
                      value={selectedProfile}
                      onChange={(e) => {
                        setSelectedProfile(e.target.value);
                        loadProfileCredentials(e.target.value);
                      }}
                    >
                      {profiles.map((profile) => (
                        <option key={profile.name} value={profile.name}>
                          {profile.name} ({profile.has_client_credentials ? "Service Principal" : "Token"})
                        </option>
                      ))}
                    </select>
                    <div className="help-text">
                      Account-level profiles for {selectedCloud === CLOUDS.AZURE ? "Azure" : selectedCloud === CLOUDS.GCP ? "GCP" : "AWS"} Databricks.
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: "16px", padding: "16px", background: "#1e1e20", borderRadius: "8px" }}>
                    <p style={{ margin: 0, color: "#aaa" }}>
                      No CLI profiles found. Add a service principal as a profile to get started.
                    </p>
                  </div>
                )}
                
                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #333", display: "flex", gap: "12px" }}>
                  <button 
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setShowAddSpProfileForm(true);
                      setSelectedProfile("");
                      setAddSpProfileData({ accountId: "", clientId: "", clientSecret: "" });
                    }}
                    style={{ fontSize: "13px", padding: "8px 16px" }}
                  >
                    + Add service principal as profile
                  </button>
                </div>
              </>
            )}

            {showAddSpProfileForm && authMode === "profile" && (
              <div style={{ marginTop: "16px", padding: "20px", background: "#1e1e20", borderRadius: "8px" }}>
                <div style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#aaa" }}>Add a service principal as a CLI profile:</span>
                  <button 
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setShowAddSpProfileForm(false);
                      setAddSpProfileData({ accountId: "", clientId: "", clientSecret: "" });
                      if (profiles.length > 0) {
                        setSelectedProfile(profiles[0].name);
                        loadProfileCredentials(profiles[0].name);
                      }
                    }}
                    style={{ fontSize: "12px", padding: "4px 12px" }}
                  >
                    ← Back to Profiles
                  </button>
                </div>
                <div className="form-group" style={{ marginBottom: "12px" }}>
                  <label>Account ID</label>
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={addSpProfileData.accountId}
                    onChange={(e) => setAddSpProfileData(prev => ({ ...prev, accountId: e.target.value }))}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "12px" }}>
                  <label>Client ID</label>
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={addSpProfileData.clientId}
                    onChange={(e) => setAddSpProfileData(prev => ({ ...prev, clientId: e.target.value }))}
                    placeholder="Service Principal Client ID"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "16px" }}>
                  <label>Client Secret</label>
                  <PasswordInput
                    value={addSpProfileData.clientSecret}
                    onChange={(e) => setAddSpProfileData(prev => ({ ...prev, clientSecret: e.target.value }))}
                    placeholder="Service Principal Client Secret"
                  />
                </div>
                <button 
                  className="btn" 
                  onClick={handleAddSpProfile}
                  disabled={loading || !addSpProfileData.accountId.trim() || !addSpProfileData.clientId.trim() || !addSpProfileData.clientSecret.trim()}
                >
                  {loading ? (
                    <>
                      <span className="spinner" />
                      Adding Profile...
                    </>
                  ) : (
                    "Add Profile"
                  )}
                </button>
                <div className="help-text" style={{ marginTop: "8px" }}>
                  Creates a new profile in <code>~/.databrickscfg</code> with the service principal credentials.
                </div>
              </div>
            )}
            
            {!databricksCli?.installed && !showExistingProfiles && (
            <Alert type="warning" style={{ marginTop: "16px" }}>
              Databricks CLI is not installed. Install it to use profile-based authentication, or select "Use Service Principal Credentials" above.
              <br /><br />
              <a href={databricksCli?.install_url} target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                Install Guide
              </a>
            </Alert>
            )}
          </>
        )}

        {authMode === "credentials" && (
          <>
            <p style={{ color: "#888", marginBottom: "12px", marginTop: "16px" }}>
              You can find these credentials in your{" "}
              <a 
                href={selectedCloud === CLOUDS.AZURE ? "https://accounts.azuredatabricks.net" : selectedCloud === CLOUDS.GCP ? "https://accounts.gcp.databricks.com" : "https://accounts.cloud.databricks.com"} 
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#ff6b35" }}
              >
                Databricks Account Console
              </a>
              . You'll need a service principal with account admin privileges.
            </p>
            <details style={{ marginBottom: "16px", fontSize: "13px" }}>
              <summary style={{ cursor: "pointer", color: "#ff6b35" }}>
                Need help creating a Databricks service principal?
              </summary>
              <p style={{ margin: "8px 0 0 0" }}>
                In the Databricks Account Console, go to User Management → Service Principals → Add service principal.
                Then create an OAuth secret and grant the Account admin role.
              </p>
            </details>
            
            <div className="form-group">
              <label>Account ID *</label>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={credentials.databricks_account_id || ""}
                onChange={(e) => handleCredentialChange("databricks_account_id", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            <div className="help-text">
              Found in Databricks Account Console. Open your top-right user menu to find a copy button for your Account ID.
            </div>
            </div>

            <div className="two-column">
              <div className="form-group">
                <label>Client ID (Service Principal) *</label>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={credentials.databricks_client_id || ""}
                  onChange={(e) => handleCredentialChange("databricks_client_id", e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
                <div className="help-text">
                  Service principal's application ID.
                </div>
              </div>
              <div className="form-group">
                <label>Client Secret *</label>
                <PasswordInput
                  value={credentials.databricks_client_secret || ""}
                  onChange={(e) => handleCredentialChange("databricks_client_secret", e.target.value)}
                  placeholder="Enter service principal secret"
                />
                <div className="help-text">
                  Service principal's OAuth secret.
                </div>
              </div>
            </div>

          </>
        )}
      </div>

      <div style={{ marginTop: "32px" }}>
        <button 
          className="btn" 
          onClick={validateAndContinue} 
          disabled={!canContinue || validatingCredentials}
        >
          {validatingCredentials ? (
            <>
              <span className="spinner" />
              Validating Credentials...
            </>
          ) : (
            "Validate & Continue →"
          )}
        </button>
      </div>
    </div>
  );
}
