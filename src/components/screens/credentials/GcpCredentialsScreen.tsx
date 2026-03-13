import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloudCredentials, GcpProject, GcpValidation } from "../../../types";
import { Alert, PermissionWarningDialog } from "../../ui";
import { useWizard } from "../../../hooks/useWizard";

export function GcpCredentialsScreen() {
  const ctx = useWizard();
  const {
    credentials, setCredentials,
    showPermissionWarning, setShowPermissionWarning,
    permissionWarningAcknowledged, setPermissionWarningAcknowledged,
    setScreen, goBack,
  } = ctx;

  const {
    validation: gcpValidation,
    authMode: gcpAuthMode,
    loading: gcpLoading,
    error: gcpAuthError,
    permissionCheck: gcpPermissionCheck,
    checkingPermissions: gcpCheckingPermissions,
    creatingServiceAccount,
    saCreationError,
    saCreationSuccess,
    showCreateSaForm,
    newSaName,
    saSetupMode,
    wantsToChangeSa,
    setAuthMode: setGcpAuthMode,
    setLoading: setGcpLoading,
    setError: setGcpAuthError,
    setValidation: setGcpValidation,
    setPermissionCheck: setGcpPermissionCheck,
    setCheckingPermissions: setGcpCheckingPermissions,
    setCreatingServiceAccount,
    setSaCreationError,
    setSaCreationSuccess,
    setShowCreateSaForm,
    setNewSaName,
    setSaSetupMode,
    setWantsToChangeSa,
  } = ctx.gcp;

  const onContinue = () => setScreen("databricks-credentials");
  const onBack = goBack;

  const handleCredentialChange = (key: keyof CloudCredentials, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  // Check GCP credentials using ADC or service account
  const checkGcpCredentials = async () => {
    setGcpLoading(true);
    setGcpAuthError(null);
    setGcpValidation(null);
    try {
      const validation = await invoke<GcpValidation>("validate_gcp_credentials", {
        credentials: {
          ...credentials,
          gcp_use_adc: gcpAuthMode === "adc",
        },
      });
      setGcpValidation(validation);
      // Always populate detected fields (project, SA email) even if not fully valid
      setCredentials(prev => ({
        ...prev,
        gcp_project_id: validation.project_id || prev.gcp_project_id,
        gcp_oauth_token: validation.oauth_token || prev.gcp_oauth_token,
        gcp_service_account_email: validation.impersonated_account || prev.gcp_service_account_email,
      }));
      if (validation.valid) {
        setGcpAuthError(null);
        setWantsToChangeSa(false);
      } else {
        setGcpAuthError(validation.message || "Validation failed");
      }
    } catch (e: unknown) {
      setGcpAuthError(String(e));
    } finally {
      setGcpLoading(false);
    }
  };

  // Auto-check credentials when the screen mounts in ADC mode.
  // The ref prevents re-runs; gcpAuthMode is a dependency so switching modes resets correctly.
  const hasAutoChecked = useRef(false);
  useEffect(() => {
    if (gcpAuthMode === "adc" && !gcpValidation && !gcpLoading && !hasAutoChecked.current) {
      hasAutoChecked.current = true;
      checkGcpCredentials();
    }
  }, [gcpAuthMode]);

  // Create GCP service account
  const handleCreateServiceAccount = async () => {
    const projectId = credentials.gcp_project_id?.trim();
    if (!projectId) {
      setSaCreationError("Please enter a GCP Project ID first");
      return;
    }
    
    const saName = newSaName.trim();
    if (!saName) {
      setSaCreationError("Service account name is required");
      return;
    }
    
    // Validate SA name format
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(saName) || saName.length < 6 || saName.length > 30) {
      setSaCreationError("Service account name must be 6-30 characters, start with a letter, and contain only lowercase letters, digits, and hyphens");
      return;
    }
    
    setCreatingServiceAccount(true);
    setSaCreationError(null);
    setSaCreationSuccess(null);
    
    try {
      const saEmail = await invoke<string>("create_gcp_service_account", {
        projectId,
        saName,
      });
      
      setCredentials(prev => ({
        ...prev,
        gcp_service_account_email: saEmail,
      }));
      
      setShowPermissionWarning(false);
      setGcpPermissionCheck(null);
      setWantsToChangeSa(false);
      setShowCreateSaForm(false);
      setCreatingServiceAccount(false);
      
      // Auto-verify credentials after SA creation
      setGcpLoading(true);
      try {
        const validation = await invoke<GcpValidation>("validate_gcp_credentials", {
          credentials: {
            ...credentials,
            gcp_service_account_email: saEmail,
            gcp_use_adc: true,
          },
        });
        setGcpValidation(validation);
        if (validation.valid) {
          setCredentials(prev => ({
            ...prev,
            gcp_project_id: validation.project_id || prev.gcp_project_id,
            gcp_oauth_token: validation.oauth_token || prev.gcp_oauth_token,
          }));
        }
      } catch {
        // Ignore validation errors after SA creation
      } finally {
        setGcpLoading(false);
      }
      
      setSaCreationSuccess(`Service account created and verified: ${saEmail}`);
    } catch (e: unknown) {
      setSaCreationError(String(e));
      setCreatingServiceAccount(false);
    }
  };

  const [validationAttempted, setValidationAttempted] = useState(false);
  const [gcpLoginInProgress, setGcpLoginInProgress] = useState(false);
  const [gcpProjects, setGcpProjects] = useState<GcpProject[]>([]);
  const [manualProjectEntry, setManualProjectEntry] = useState(false);

  const loadGcpProjects = useCallback(async () => {
    try {
      const projects = await invoke<GcpProject[]>("get_gcp_projects");
      setGcpProjects(projects);
      if (projects.length > 0 && !credentials.gcp_project_id) {
        const detected = gcpValidation?.project_id;
        const match = detected && projects.find(p => p.project_id === detected);
        if (match) {
          handleCredentialChange("gcp_project_id", match.project_id);
        }
      }
    } catch {
      setGcpProjects([]);
    }
  }, [credentials.gcp_project_id, gcpValidation?.project_id]);

  const hasLoadedProjects = useRef(false);
  useEffect(() => {
    if (gcpValidation?.account && !hasLoadedProjects.current) {
      hasLoadedProjects.current = true;
      loadGcpProjects();
    }
  }, [gcpValidation?.account, loadGcpProjects]);

  const handleGcpLogin = async () => {
    setGcpLoading(true);
    setGcpLoginInProgress(true);
    setGcpAuthError(null);
    try {
      await invoke("gcp_login");
      hasLoadedProjects.current = false;
      await checkGcpCredentials();
      await loadGcpProjects();
    } catch (e: unknown) {
      const msg = String(e);
      if (msg !== "LOGIN_CANCELLED") {
        setGcpAuthError(msg);
      }
    } finally {
      setGcpLoginInProgress(false);
      setGcpLoading(false);
    }
  };

  const cancelGcpLogin = async () => {
    try {
      await invoke("cancel_cli_login");
    } catch {
      // Best-effort cancellation
    }
    setGcpLoginInProgress(false);
    setGcpLoading(false);
  };

  // ADC mode: validate project + service account, check impersonation match
  // Service account mode: validate project + JSON key
  // Then run permission check (soft warning, does not block)
  
  // Validate and continue from GCP credentials
  const validateAndContinue = async () => {
    setValidationAttempted(true);
    setGcpAuthError(null);
    
    if (gcpAuthMode === "adc") {
      if (!credentials.gcp_project_id?.trim()) {
        setGcpAuthError("GCP Project ID is required");
        return;
      }
      if (!credentials.gcp_service_account_email?.trim()) {
        setGcpAuthError("Service Account Email is required");
        return;
      }
      
      setGcpLoading(true);
      try {
        const validation = await invoke<GcpValidation>("validate_gcp_credentials", {
          credentials: {
            ...credentials,
            gcp_use_adc: true,
          },
        });
        setGcpValidation(validation);
        
        if (!validation.valid) {
          setGcpAuthError(validation.message || "Validation failed");
          setGcpLoading(false);
          return;
        }
        
        setCredentials(prev => ({
          ...prev,
          gcp_project_id: validation.project_id || prev.gcp_project_id,
          gcp_oauth_token: validation.oauth_token || prev.gcp_oauth_token,
          gcp_service_account_email: validation.impersonated_account || prev.gcp_service_account_email,
        }));
        
        if (!validation.impersonated_account) {
          setGcpAuthError(
            "No service account impersonation configured.\n" +
            "Please use the 'Create New' option or configure impersonation via CLI first."
          );
          setGcpLoading(false);
          return;
        }
        if (validation.impersonated_account !== credentials.gcp_service_account_email?.trim()) {
          setGcpAuthError(
            `Impersonation mismatch: gcloud is impersonating '${validation.impersonated_account}' but you entered '${credentials.gcp_service_account_email}'.\n\nClick 'Refresh' to auto-fill the correct service account.`
          );
          setGcpLoading(false);
          return;
        }
        
        setCredentials(prev => ({ ...prev, gcp_use_adc: true }));
      } catch (e: unknown) {
        setGcpAuthError(String(e));
        setGcpLoading(false);
        return;
      } finally {
        setGcpLoading(false);
      }
    } else {
      if (!credentials.gcp_project_id?.trim()) {
        setGcpAuthError("GCP Project ID is required");
        return;
      }
      if (!credentials.gcp_credentials_json?.trim()) {
        setGcpAuthError("Service Account JSON is required");
        return;
      }
      try {
        const saJson = JSON.parse(credentials.gcp_credentials_json);
        const saEmail = saJson.client_email || "";
        setCredentials(prev => ({ 
          ...prev, 
          gcp_use_adc: false,
          gcp_service_account_email: saEmail || prev.gcp_service_account_email,
        }));
      } catch {
        setCredentials(prev => ({ ...prev, gcp_use_adc: false }));
      }
    }
    
    // Check GCP permissions (soft warning, won't block)
    setGcpCheckingPermissions(true);
    try {
      const permCheck = await invoke<import("../../../types").CloudPermissionCheck>("check_gcp_permissions", {
        credentials: {
          ...credentials,
          gcp_use_adc: gcpAuthMode === "adc",
          cloud: "gcp",
        },
      });
      setGcpPermissionCheck(permCheck);
      
      if (!permCheck.has_all_permissions && permCheck.missing_permissions.length > 0) {
        setShowPermissionWarning(true);
        setPermissionWarningAcknowledged(false);
        setGcpCheckingPermissions(false);
        return;
      }
    } catch {
      setGcpPermissionCheck({
        has_all_permissions: true,
        checked_permissions: [],
        missing_permissions: [],
        message: "Permission check skipped due to an error.",
        is_warning: true,
      });
    }
    setGcpCheckingPermissions(false);
    
    onContinue();
  };

  const continueWithWarning = () => {
    setShowPermissionWarning(false);
    setPermissionWarningAcknowledged(false);
    onContinue();
  };

  // For ADC mode, only require input fields - validation happens on button click
  // For service account mode, require project ID and JSON key
  const canContinue = gcpAuthMode === "adc" 
    ? !!(credentials.gcp_project_id?.trim() && credentials.gcp_service_account_email?.trim()) 
    : !!(credentials.gcp_project_id?.trim() && credentials.gcp_credentials_json?.trim());

  return (
    <div className="container">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h1>GCP Credentials</h1>
      <p className="subtitle">
        Configure your GCP credentials for deploying resources.
      </p>

      {gcpLoading && (
        <Alert type="loading">
          {gcpLoginInProgress ? "Signing in with GCP..." : "Verifying GCP credentials..."}
        </Alert>
      )}

      {gcpAuthError && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{gcpAuthError}</Alert>}

      <div className="form-section" style={{ opacity: gcpLoading ? 0.6 : 1 }}>
        <h3>Authentication Method</h3>
        
        <div className="auth-mode-selector">
          <label className="radio-label">
            <input
              type="radio"
              checked={gcpAuthMode === "adc"}
              disabled={gcpLoading}
              onChange={() => {
                setGcpAuthMode("adc");
                setShowPermissionWarning(false);
                setPermissionWarningAcknowledged(false);
              }}
            />
            Use Application Default Credentials (recommended)
          </label>
          <label className="radio-label">
            <input
              type="radio"
              checked={gcpAuthMode === "service_account"}
              disabled={gcpLoading}
              onChange={() => {
                setGcpAuthMode("service_account");
                setShowPermissionWarning(false);
                setPermissionWarningAcknowledged(false);
              }}
            />
            Use Service Account Key
          </label>
        </div>

        {gcpAuthMode === "adc" && (
          <>
            <details style={{ marginBottom: "16px", fontSize: "13px" }}>
              <summary style={{ cursor: "pointer", color: "#ff6b35" }}>
                Getting started with GCP Application Default Credentials
              </summary>
              <div style={{ marginTop: "8px" }}>
                Click <strong>Sign in with GCP</strong> below, or run <code>gcloud auth login</code> in your terminal and click <strong>Refresh</strong>. You'll also need to set up a service account with impersonation using the options below.
              </div>
            </details>

            <div className="form-group">
              <label>
                Status:{" "}
                {gcpLoading && (
                  <span style={{ fontWeight: "normal", color: "#888" }}>
                    {gcpLoginInProgress ? "Waiting for browser login..." : "Verifying..."}
                  </span>
                )}
                {!gcpLoading && gcpValidation?.account && (
                  <span className="success" style={{ fontWeight: "normal" }}>
                    Authenticated as {gcpValidation.account}
                  </span>
                )}
                {!gcpLoading && !gcpValidation?.account && (
                  <span style={{ fontWeight: "normal", color: "#888" }}>
                    {gcpValidation ? "No account detected" : "Not signed in"}
                  </span>
                )}
              </label>
              {(gcpLoginInProgress || gcpLoading) && <span className="spinner" />}
              <div style={{ marginTop: "8px" }}>
                {gcpLoginInProgress ? (
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={cancelGcpLogin}
                  >
                    Cancel
                  </button>
                ) : gcpValidation?.account ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-small btn-secondary"
                      onClick={handleGcpLogin}
                      disabled={gcpLoading || gcpCheckingPermissions}
                    >
                      Switch Account
                    </button>
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#888" }}>
                      Switched accounts via CLI?{" "}
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); checkGcpCredentials(); }}
                        style={{ color: "#ff6b35" }}
                      >
                        {gcpLoading ? "Checking..." : "Refresh"}
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={handleGcpLogin}
                      disabled={gcpLoading || gcpCheckingPermissions}
                    >
                      Sign in with GCP
                    </button>
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#888" }}>
                      Already logged in via CLI?{" "}
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); checkGcpCredentials(); }}
                        style={{ color: "#ff6b35" }}
                      >
                        {gcpLoading ? "Checking..." : "Refresh"}
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>

            {gcpValidation?.account && (
            <>
            <div className="form-group" style={{ marginTop: "16px" }}>
              <label>Project *</label>
              {gcpProjects.length > 0 && !manualProjectEntry ? (
                <>
                  <select
                    value={credentials.gcp_project_id || ""}
                    onChange={(e) => handleCredentialChange("gcp_project_id", e.target.value)}
                    disabled={gcpLoading}
                  >
                    <option value="">Select a project...</option>
                    {gcpProjects.map((p) => (
                      <option key={p.project_id} value={p.project_id}>
                        {p.name} ({p.project_id})
                      </option>
                    ))}
                  </select>
                  <div className="help-text">
                    The GCP project where resources will be deployed.{" "}
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); setManualProjectEntry(true); }}
                      style={{ color: "#ff6b35" }}
                    >
                      Enter ID manually
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={credentials.gcp_project_id || ""}
                    onChange={(e) => handleCredentialChange("gcp_project_id", e.target.value)}
                    placeholder="my-gcp-project"
                    disabled={gcpLoading}
                  />
                  <div className="help-text">
                    The GCP project where resources will be deployed.
                    {gcpProjects.length > 0 && (
                      <>
                        {" "}
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); setManualProjectEntry(false); }}
                          style={{ color: "#ff6b35" }}
                        >
                          Select from list
                        </a>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <h3 style={{ marginTop: "24px", marginBottom: "4px" }}>Service Account Impersonation</h3>
            <p style={{ fontSize: "13px", color: "#888", margin: "0 0 12px 0" }}>
              A service account with deployment permissions is required.
            </p>

            <div className="form-group">
              <label>Service Account *</label>
              
              {gcpValidation?.impersonated_account && 
               credentials.gcp_service_account_email?.trim() && 
               gcpValidation.impersonated_account === credentials.gcp_service_account_email?.trim() &&
               !wantsToChangeSa ? (
                <>
                  <input
                    type="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={credentials.gcp_service_account_email || ""}
                    onChange={(e) => handleCredentialChange("gcp_service_account_email", e.target.value)}
                    placeholder="my-service-account@my-project.iam.gserviceaccount.com"
                    disabled={gcpLoading}
                  />
                  <div className="help-text" style={{ color: showPermissionWarning ? "#f59e0b" : "#4ade80" }}>
                    {showPermissionWarning ? (
                      "⚠ Service account verified but missing some permissions"
                    ) : (
                      "✓ Verified - impersonating this service account"
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => setWantsToChangeSa(true)}
                    style={{ marginTop: "12px" }}
                  >
                    Use Different Service Account
                  </button>
                </>
              ) : (
                <>
                  {saCreationSuccess ? (
                    <Alert type="success" style={{ marginTop: "8px" }}>
                      <div style={{ fontWeight: "600", marginBottom: "4px" }}>
                        ✓ {saCreationSuccess}
                      </div>
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={() => setSaCreationSuccess(null)}
                        style={{ marginTop: "8px" }}
                      >
                        Dismiss
                      </button>
                    </Alert>
                  ) : (
                    <>
                      {wantsToChangeSa && gcpValidation?.impersonated_account && (
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => setWantsToChangeSa(false)}
                          style={{ marginBottom: "12px" }}
                        >
                          ← Back to Current SA
                        </button>
                      )}
                      <details style={{ marginTop: "8px" }}>
                        <summary style={{
                          cursor: "pointer",
                          fontSize: "13px",
                          color: "#3b82f6",
                          padding: "10px 14px",
                          border: "1px dashed #3b82f6",
                          borderRadius: "8px",
                          marginBottom: "12px",
                          listStyle: "none",
                          userSelect: "none",
                        }}>
                          ＋ Set up a Service Account
                        </summary>

                      <div style={{ display: "flex", gap: "0", marginBottom: "12px", marginTop: "8px" }}>
                        <button
                          type="button"
                          onClick={() => setSaSetupMode("create")}
                          disabled={gcpLoading}
                          style={{
                            padding: "8px 16px",
                            border: "1px solid #444",
                            borderRight: "none",
                            borderRadius: "6px 0 0 6px",
                            backgroundColor: saSetupMode === "create" ? "#3b82f6" : "transparent",
                            color: saSetupMode === "create" ? "#fff" : "#aaa",
                            cursor: gcpLoading ? "not-allowed" : "pointer",
                            fontSize: "13px",
                            opacity: gcpLoading ? 0.6 : 1,
                          }}
                        >
                          + Create New
                        </button>
                        <button
                          type="button"
                          onClick={() => setSaSetupMode("existing")}
                          disabled={gcpLoading}
                          style={{
                            padding: "8px 16px",
                            border: "1px solid #444",
                            borderRadius: "0 6px 6px 0",
                            backgroundColor: saSetupMode === "existing" ? "#3b82f6" : "transparent",
                            color: saSetupMode === "existing" ? "#fff" : "#aaa",
                            cursor: gcpLoading ? "not-allowed" : "pointer",
                            fontSize: "13px",
                            opacity: gcpLoading ? 0.6 : 1,
                          }}
                        >
                          Use Existing
                        </button>
                      </div>

                      {saSetupMode === "existing" ? (
                        <div 
                          style={{ 
                            padding: "16px",
                            border: "1px solid #444",
                            borderRadius: "8px",
                            backgroundColor: "rgba(255, 255, 255, 0.02)"
                          }}
                        >
                          <div style={{ fontSize: "13px", color: "#aaa", marginBottom: "12px" }}>
                            To use an existing service account, configure impersonation via the gcloud CLI:
                          </div>
                          <code style={{ 
                            display: "block",
                            padding: "10px 12px", 
                            backgroundColor: "rgba(255, 255, 255, 0.05)", 
                            borderRadius: "6px",
                            fontSize: "12px",
                            marginBottom: "12px",
                            color: "#ccc"
                          }}>
                            gcloud config set auth/impersonate_service_account YOUR_SA@PROJECT.iam.gserviceaccount.com
                          </code>
                          <div className="help-text" style={{ fontSize: "12px", marginBottom: "12px" }}>
                            <strong>Requirements:</strong> The service account must have permissions for VPC, storage, and IAM operations, and be added as a user in the{" "}
                            <a href="https://accounts.gcp.databricks.com" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                              Databricks Account Console
                            </a>.
                          </div>
                          <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            onClick={checkGcpCredentials}
                            disabled={gcpLoading || gcpCheckingPermissions}
                          >
                            {gcpLoading ? "Verifying..." : "Verify"}
                          </button>
                        </div>
                      ) : (
                        <div 
                          style={{ 
                            padding: "16px",
                            border: "1px solid #3b82f6",
                            borderRadius: "8px",
                            backgroundColor: "rgba(59, 130, 246, 0.1)"
                          }}
                        >
                          {!showCreateSaForm ? (
                            <>
                              <div style={{ fontSize: "13px", color: "#ccc", marginBottom: "12px" }}>
                                This will:
                                <ol style={{ margin: "4px 0 0 0", paddingLeft: "20px" }}>
                                  <li>Create a new service account in your GCP project.</li>
                                  <li>Create a custom role with required permissions and assign it to the service account.</li>
                                  <li>Configure impersonation in gcloud so the service account can be used for deployment.</li>
                                </ol>
                              </div>
                              <button
                                type="button"
                                className="btn btn-small btn-primary"
                                onClick={() => setShowCreateSaForm(true)}
                                disabled={gcpLoading || !credentials.gcp_project_id?.trim()}
                              >
                                Create Service Account
                              </button>
                              {!credentials.gcp_project_id?.trim() && (
                                <div className="help-text" style={{ marginTop: "8px", color: "#f59e0b" }}>
                                  Enter a Project ID first
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="form-group" style={{ marginBottom: "12px" }}>
                                <label style={{ fontSize: "13px" }}>Service Account Name</label>
                                <input
                                  type="text"
                                  value={newSaName}
                                  onChange={(e) => setNewSaName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                  placeholder="databricks-deployer"
                                  style={{ marginTop: "4px" }}
                                  disabled={gcpLoading || creatingServiceAccount}
                                />
                                <div className="help-text" style={{ fontSize: "11px", marginTop: "2px" }}>
                                  6-30 characters, lowercase letters, digits, and hyphens only.
                                </div>
                              </div>
                              
                              {saCreationError && (
                                <Alert type="error" style={{ marginBottom: "12px" }}>
                                  {saCreationError}
                                </Alert>
                              )}
                              
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                  type="button"
                                  className="btn btn-small btn-primary"
                                  onClick={handleCreateServiceAccount}
                                  disabled={creatingServiceAccount || !newSaName.trim()}
                                >
                                  {creatingServiceAccount ? (
                                    <>
                                      <span className="spinner" style={{ marginRight: "6px" }} />
                                      Creating...
                                    </>
                                  ) : (
                                    "Create"
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-small btn-secondary"
                                  onClick={() => {
                                    setShowCreateSaForm(false);
                                    setSaCreationError(null);
                                  }}
                                  disabled={creatingServiceAccount}
                                >
                                  Cancel
                                </button>
                              </div>
                              
                              {creatingServiceAccount && (
                                <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(59, 130, 246, 0.15)", borderRadius: "6px", fontSize: "13px" }}>
                                  <div style={{ marginBottom: "8px", fontWeight: "500" }}>
                                    Setting up service account...
                                  </div>
                                  <ul style={{ margin: 0, paddingLeft: "20px", color: "#aaa", fontSize: "12px" }}>
                                    <li>Creating service account in GCP.</li>
                                    <li>Creating custom role with required permissions.</li>
                                    <li>Granting permissions to service account.</li>
                                    <li>Granting you permission to impersonate.</li>
                                    <li>Waiting for IAM propagation (can take up to 2 minutes).</li>
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      </details>
                    </>
                  )}
                </>
              )}
            </div>

            {gcpValidation?.valid && (
              <Alert type="success" style={{ marginTop: "16px" }}>
                {gcpValidation.message}
              </Alert>
            )}
            </>
            )}
          </>
        )}

        {gcpAuthMode === "service_account" && (
          <>
            <Alert type="warning" style={{ marginBottom: "16px" }}>
              Service account keys should be kept secure and rotated regularly.
            </Alert>
            
            <div className="form-group">
              <label>Project *</label>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={credentials.gcp_project_id || ""}
                onChange={(e) => handleCredentialChange("gcp_project_id", e.target.value)}
                placeholder="my-gcp-project"
              />
              <div className="help-text">The GCP project where resources will be deployed.</div>
            </div>
            
            <div className="form-group">
              <label>Service Account Key JSON *</label>
              <textarea
                value={credentials.gcp_credentials_json || ""}
                onChange={(e) => {
                  handleCredentialChange("gcp_credentials_json", e.target.value);
                  // Try to auto-detect project_id from JSON
                  try {
                    const parsed = JSON.parse(e.target.value);
                    if (parsed.project_id && !credentials.gcp_project_id) {
                      handleCredentialChange("gcp_project_id", parsed.project_id);
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }}
                placeholder='Paste your service account JSON key here...
{
  "type": "service_account",
  "project_id": "...",
  ...
}'
                rows={8}
                style={{ fontFamily: "monospace", fontSize: "12px" }}
              />
              <div className="help-text">
                Download from Google Cloud Console → IAM & Admin → Service Accounts → Keys.
              </div>
            </div>
          </>
        )}
      </div>

      {showPermissionWarning && gcpPermissionCheck && !gcpPermissionCheck.has_all_permissions && (
        <PermissionWarningDialog
          cloud="gcp"
          permissionCheck={gcpPermissionCheck}
          acknowledged={permissionWarningAcknowledged}
          onAcknowledgeChange={setPermissionWarningAcknowledged}
        />
      )}

      <div className="mt-32">
        <button 
          className="btn" 
          onClick={showPermissionWarning ? continueWithWarning : validateAndContinue} 
          disabled={!canContinue || gcpCheckingPermissions || gcpLoading || (showPermissionWarning && !permissionWarningAcknowledged)}
        >
          {gcpLoading ? (
            <>
              <span className="spinner" />
              Validating Credentials...
            </>
          ) : gcpCheckingPermissions ? (
            <>
              <span className="spinner" />
              Checking Permissions...
            </>
          ) : (
            "Validate & Continue →"
          )}
        </button>
        {validationAttempted && gcpAuthError && (
          <div className="mt-8 text-sm text-error">
            Validation failed - see error details above
          </div>
        )}
      </div>
    </div>
  );
}
