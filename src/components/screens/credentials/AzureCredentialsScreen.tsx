import { useState, useMemo } from "react";
import { CloudCredentials } from "../../../types";
import { Alert, PermissionWarningDialog, PasswordInput } from "../../ui";
import { useWizard } from "../../../hooks/useWizard";

export function AzureCredentialsScreen() {
  const ctx = useWizard();
  const { credentials, setCredentials } = ctx;
  const azureAccount = ctx.azure.account;
  const azureSubscriptions = ctx.azure.subscriptions;
  const azureAuthMode = ctx.azure.authMode;
  const setAzureAuthMode = ctx.azure.setAuthMode;
  const azureLoading = ctx.azure.loading;
  const azureAuthError = ctx.azure.error;
  const azurePermissionCheck = ctx.azure.permissionCheck;
  const { checkingPermissions, showPermissionWarning, setShowPermissionWarning } = ctx;
  const { permissionWarningAcknowledged, setPermissionWarningAcknowledged } = ctx;
  const validationAttempted = ctx.azureValidationAttempted;
  const azureLoginInProgress = ctx.azure.loginInProgress;
  const onCheckAccount = ctx.checkAzureAccount;
  const onLogin = ctx.handleAzureLogin;
  const onCancelLogin = ctx.azure.cancelLogin;
  const onSubscriptionChange = ctx.handleAzureSubscriptionChange;
  const onValidateAndContinue = ctx.validateAndContinueFromAzureCredentials;
  const onContinueWithWarning = ctx.continueFromCloudWithWarning;
  const onBack = ctx.goBack;
  const handleCredentialChange = (key: keyof CloudCredentials, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const [showSubscriptionHelp, setShowSubscriptionHelp] = useState(false);
  const selectedSubscription = azureSubscriptions.find(
    (sub) => sub.id === credentials.azure_subscription_id
  );

  const tenantGroups = useMemo(() => {
    const tenantIds = [...new Set(azureSubscriptions.map((s) => s.tenant_id))];
    if (tenantIds.length <= 1) return null;
    const loginTenant = azureAccount?.tenant_id;
    return tenantIds
      .sort((a, b) => (a === loginTenant ? -1 : b === loginTenant ? 1 : a.localeCompare(b)))
      .map((tid) => ({
        tenantId: tid,
        label: tid === loginTenant ? `Tenant: ${tid.slice(0, 8)}... (current)` : `Tenant: ${tid.slice(0, 8)}...`,
        subscriptions: azureSubscriptions.filter((s) => s.tenant_id === tid),
      }));
  }, [azureSubscriptions, azureAccount?.tenant_id]);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validateUuid = (val: string | undefined) => !val?.trim() || uuidRegex.test(val.trim());

  const canContinue = azureAuthMode === "cli" 
    ? !!(azureAccount && credentials.azure_subscription_id) 
    : !!(credentials.azure_tenant_id?.trim() && credentials.azure_subscription_id?.trim() && 
         credentials.azure_client_id?.trim() && credentials.azure_client_secret?.trim());

  return (
    <div className="container">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h1>Azure Credentials</h1>
      <p className="subtitle">
        Configure your Azure credentials for deploying resources.
      </p>

      {azureLoading && !azureLoginInProgress && (
        <Alert type="loading">Verifying Azure credentials...</Alert>
      )}

      {azureAuthError && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{azureAuthError}</Alert>}

      <div className="form-section" style={{ opacity: azureLoading && !azureLoginInProgress ? 0.6 : 1 }}>
        <h3>Authentication Method</h3>
        
        <div className="auth-mode-selector">
          <label className="radio-label">
            <input
              type="radio"
              checked={azureAuthMode === "cli"}
              onChange={() => {
                setAzureAuthMode("cli");
                setShowPermissionWarning(false);
                setPermissionWarningAcknowledged(false);
              }}
            />
            Use Azure CLI (recommended)
          </label>
          <label className="radio-label">
            <input
              type="radio"
              checked={azureAuthMode === "service_principal"}
              onChange={() => {
                setAzureAuthMode("service_principal");
                setShowPermissionWarning(false);
                setPermissionWarningAcknowledged(false);
              }}
            />
            Use Service Principal Credentials
          </label>
        </div>

        {azureAuthMode === "cli" && (
          <>
            <details style={{ marginBottom: "16px", fontSize: "13px" }}>
              <summary style={{ cursor: "pointer", color: "#ff6b35" }}>
                Need help setting up Azure CLI?
              </summary>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
                <li>Install the <a href="https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>Azure CLI</a>.</li>
                <li>Click <strong>Sign in with Azure</strong> below, or run <code>az login</code> (optionally <code>az login --tenant YOUR_TENANT_ID</code>) in your terminal and click <strong>Refresh</strong>.</li>
              </ol>
            </details>
            
            <div className="form-group">
              <label>
                Status:{" "}
                {azureLoginInProgress && (
                  <span style={{ fontWeight: "normal", color: "#888" }}>Waiting for browser login...</span>
                )}
                {!azureLoginInProgress && azureLoading && (
                  <span style={{ fontWeight: "normal", color: "#888" }}>Verifying...</span>
                )}
                {!azureLoginInProgress && !azureLoading && azureAccount && (
                  <span className="success" style={{ fontWeight: "normal" }}>Logged in as {azureAccount.user}</span>
                )}
                {!azureLoginInProgress && !azureLoading && !azureAccount && (
                  <span style={{ fontWeight: "normal", color: "#888" }}>Not signed in</span>
                )}
              </label>
              {(azureLoginInProgress || azureLoading) && <span className="spinner" />}
              <div style={{ marginTop: "8px" }}>
                {azureLoginInProgress ? (
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={onCancelLogin}
                  >
                    Cancel
                  </button>
                ) : azureAccount ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-small btn-secondary"
                      onClick={onLogin}
                      disabled={azureLoading || checkingPermissions}
                    >
                      Switch Account
                    </button>
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#888" }}>
                      Switched accounts via CLI?{" "}
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); onCheckAccount(); }}
                        style={{ color: "#ff6b35" }}
                      >
                        {azureLoading ? "Checking..." : "Refresh"}
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={onLogin}
                      disabled={azureLoading || checkingPermissions}
                    >
                      Sign in with Azure
                    </button>
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#888" }}>
                      Already logged in via CLI?{" "}
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); onCheckAccount(); }}
                        style={{ color: "#ff6b35" }}
                      >
                        {azureLoading ? "Checking..." : "Refresh"}
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>

            {azureAccount && azureSubscriptions.length > 0 && (
              <div className="form-group" style={{ marginTop: "16px" }}>
                <label>Subscription</label>
                <select
                  value={credentials.azure_subscription_id || ""}
                  onChange={(e) => onSubscriptionChange(e.target.value)}
                >
                  <option value="">Select a subscription...</option>
                  {tenantGroups ? (
                    tenantGroups.map((group) => (
                      <optgroup key={group.tenantId} label={group.label}>
                        {group.subscriptions.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name} {sub.is_default ? "(default)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  ) : (
                    azureSubscriptions.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name} {sub.is_default ? "(default)" : ""}
                      </option>
                    ))
                  )}
                </select>
                <div className="help-text">
                  Select the Azure subscription to deploy resources to.{" "}
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setShowSubscriptionHelp(true); }}
                    style={{ color: "#ff6b35" }}
                  >
                    Can't find your subscription?
                  </a>
                </div>
              </div>
            )}

            {showSubscriptionHelp && (
              <div className="dialog-overlay">
                <div className="dialog">
                  <h3>Subscription Not Listed?</h3>
                  <p style={{ fontSize: "13px", lineHeight: "1.6" }}>
                    The dropdown shows all subscriptions accessible by your current Azure login, including guest tenants. If yours is missing:
                  </p>
                  <ol style={{ fontSize: "13px", lineHeight: "1.8", paddingLeft: "20px" }}>
                    <li>
                      <strong>No access:</strong> Ask your Azure admin to grant you at least <em>Contributor</em> role on the subscription.
                    </li>
                    <li>
                      <strong>Subscription disabled:</strong> Check in the{" "}
                      <a href="https://portal.azure.com/#blade/Microsoft_Azure_Billing/SubscriptionsBlade" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                        Azure Portal → Subscriptions
                      </a>{" "}
                      that the subscription is in an <em>Active</em> state.
                    </li>
                    <li>
                      <strong>Tenant not linked:</strong> If your account hasn't been invited to the subscription's tenant, 
                      try <code>az login --tenant YOUR_TENANT_ID</code> then click <strong>Refresh</strong> above.
                    </li>
                  </ol>
                  <div className="dialog-buttons">
                    <button onClick={() => setShowSubscriptionHelp(false)} className="primary">
                      Got it
                    </button>
                  </div>
                </div>
              </div>
            )}

            {azureAccount && (
              <Alert type="success" style={{ marginTop: "16px" }}>
                Using subscription:{" "}
                <strong>{selectedSubscription?.name || azureAccount.subscription_name || "Not selected"}</strong>
                <br />
                <span style={{ fontSize: "12px", opacity: 0.8 }}>
                  Tenant: {selectedSubscription?.tenant_id || credentials.azure_tenant_id || azureAccount.tenant_id}
                </span>
              </Alert>
            )}
          </>
        )}

        {azureAuthMode === "service_principal" && (
          <>
            <details style={{ marginBottom: "16px", fontSize: "13px" }}>
              <summary style={{ cursor: "pointer", color: "#ff6b35" }}>
                Need help creating a service principal?
              </summary>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
                <li>Go to <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>Azure Portal → App Registrations</a> and create a new registration.</li>
                <li>Note the Application (Client) ID and Directory (Tenant) ID.</li>
                <li>Under Certificates & Secrets, create a new client secret.</li>
              </ol>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#ffb347" }}>
                ⚠️ Service principal credentials require manual rotation. Use Azure CLI when possible.
              </p>
            </details>
            <div className="two-column">
              <div className="form-group">
                <label>Tenant ID *</label>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={credentials.azure_tenant_id || ""}
                  onChange={(e) => handleCredentialChange("azure_tenant_id", e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
                {credentials.azure_tenant_id?.trim() && !validateUuid(credentials.azure_tenant_id) && (
                  <div style={{ color: "var(--warning)", fontSize: "12px", marginTop: "4px" }}>Expected UUID format</div>
                )}
                <div className="help-text">Found in Azure Portal → Microsoft Entra ID.</div>
              </div>
              <div className="form-group">
                <label>Subscription ID *</label>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={credentials.azure_subscription_id || ""}
                  onChange={(e) => handleCredentialChange("azure_subscription_id", e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
                <div className="help-text">Found in Azure Portal → Subscriptions.</div>
              </div>
            </div>
            <div className="two-column">
              <div className="form-group">
                <label>Client ID *</label>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={credentials.azure_client_id || ""}
                  onChange={(e) => handleCredentialChange("azure_client_id", e.target.value)}
                  placeholder="Service Principal Application ID"
                />
              </div>
              <div className="form-group">
                <label>Client Secret *</label>
                <PasswordInput
                  value={credentials.azure_client_secret || ""}
                  onChange={(e) => handleCredentialChange("azure_client_secret", e.target.value)}
                  placeholder="Service Principal Secret"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {showPermissionWarning && azurePermissionCheck && !azurePermissionCheck.has_all_permissions && (
        <PermissionWarningDialog
          cloud="azure"
          permissionCheck={azurePermissionCheck}
          acknowledged={permissionWarningAcknowledged}
          onAcknowledgeChange={setPermissionWarningAcknowledged}
        />
      )}

      <div className="mt-32">
        <button 
          className="btn" 
          onClick={showPermissionWarning ? onContinueWithWarning : onValidateAndContinue} 
          disabled={!canContinue || checkingPermissions || azureLoading || (showPermissionWarning && !permissionWarningAcknowledged)}
        >
          {azureLoading ? (
            <>
              <span className="spinner" />
              Validating Credentials...
            </>
          ) : checkingPermissions ? (
            <>
              <span className="spinner" />
              Checking Permissions...
            </>
          ) : (
            "Validate & Continue →"
          )}
        </button>
        {validationAttempted && azureAuthError && (
          <div className="mt-8 text-sm text-error">
            Validation failed - see error details above
          </div>
        )}
      </div>
    </div>
  );
}
