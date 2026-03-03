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
  const onCheckAccount = ctx.checkAzureAccount;
  const onLogin = ctx.handleAzureLogin;
  const onSubscriptionChange = ctx.handleAzureSubscriptionChange;
  const onValidateAndContinue = ctx.validateAndContinueFromAzureCredentials;
  const onContinueWithWarning = ctx.continueFromCloudWithWarning;
  const onBack = ctx.goBack;
  const handleCredentialChange = (key: keyof CloudCredentials, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

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

      {azureLoading && (
        <Alert type="loading">Verifying Azure credentials...</Alert>
      )}

      {azureAuthError && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{azureAuthError}</Alert>}

      <div className="form-section" style={{ opacity: azureLoading ? 0.6 : 1 }}>
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
            <Alert type="info" style={{ marginBottom: "16px" }}>
              <strong>How to set up Azure CLI:</strong>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "13px" }}>
                <li>Install the <a href="https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>Azure CLI</a>.</li>
                <li>Run <code>az login</code> to authenticate.</li>
                <li>Click <strong>Verify</strong> below to detect your subscriptions.</li>
              </ol>
            </Alert>
            
            <div className="form-group">
              <label>Status</label>
              <div className="auth-status">
                {azureLoading && <span className="spinner" />}
                {azureAccount && (
                  <span className="success">
                    Logged in as: {azureAccount.user}
                  </span>
                )}
                {azureAuthError && !azureLoading && !azureAccount && (
                  <span className="error">{azureAuthError}</span>
                )}
                {!azureAccount && !azureAuthError && !azureLoading && (
                  <span style={{ color: "#888" }}>Click Verify or Login to check credentials.</span>
                )}
              </div>
              <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  onClick={onCheckAccount}
                  disabled={azureLoading}
                >
                  {azureLoading ? "Verifying..." : "Verify"}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={onLogin}
                  disabled={azureLoading}
                >
                  Login
                </button>
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
                  {azureSubscriptions.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name} {sub.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </select>
                <div className="help-text">Select the Azure subscription to deploy resources to.</div>
              </div>
            )}

            {azureAccount && (
              <Alert type="success" style={{ marginTop: "16px" }}>
                Using subscription: <strong>{azureAccount.subscription_name}</strong>
                <br />
                <span style={{ fontSize: "12px", opacity: 0.8 }}>Tenant: {azureAccount.tenant_id}</span>
              </Alert>
            )}
          </>
        )}

        {azureAuthMode === "service_principal" && (
          <>
            <Alert type="info" style={{ marginBottom: "16px" }}>
              <strong>How to create a service principal:</strong>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "13px" }}>
                <li>Go to <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>Azure Portal → App Registrations</a> and create a new registration.</li>
                <li>Note the Application (Client) ID and Directory (Tenant) ID.</li>
                <li>Under Certificates & Secrets, create a new client secret.</li>
              </ol>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#ffb347" }}>
                ⚠️ Service principal credentials require manual rotation. Use Azure CLI when possible.
              </p>
            </Alert>
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
