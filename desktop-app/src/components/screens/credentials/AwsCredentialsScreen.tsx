import { CloudCredentials } from "../../../types";
import { Alert, PermissionWarningDialog, PasswordInput } from "../../ui";
import { useWizard } from "../../../hooks/useWizard";

export function AwsCredentialsScreen() {
  const ctx = useWizard();
  const { credentials, setCredentials } = ctx;
  const awsProfiles = ctx.aws.profiles;
  const awsIdentity = ctx.aws.identity;
  const awsAuthMode = ctx.aws.authMode;
  const setAwsAuthMode = ctx.aws.setAuthMode;
  const awsLoading = ctx.aws.loading;
  const awsAuthError = ctx.aws.error;
  const awsPermissionCheck = ctx.aws.permissionCheck;
  const { checkingPermissions, showPermissionWarning, setShowPermissionWarning } = ctx;
  const { permissionWarningAcknowledged, setPermissionWarningAcknowledged } = ctx;
  const validationAttempted = ctx.awsValidationAttempted;
  const onCheckIdentity = ctx.aws.checkIdentity;
  const onSsoLogin = ctx.handleAwsSsoLogin;
  const onProfileChange = ctx.handleAwsProfileChange;
  const onValidateAndContinue = ctx.validateAndContinueFromAwsCredentials;
  const onContinueWithWarning = ctx.continueFromCloudWithWarning;
  const onBack = ctx.goBack;
  const handleCredentialChange = (key: keyof CloudCredentials, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const canContinue = awsAuthMode === "profile" 
    ? !!awsIdentity 
    : !!(credentials.aws_access_key_id?.trim() && credentials.aws_secret_access_key?.trim());

  return (
    <div className="container">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h1>AWS Credentials</h1>
      <p className="subtitle">
        Configure your AWS credentials for deploying resources.
      </p>

      {awsLoading && (
        <Alert type="loading">Verifying AWS credentials...</Alert>
      )}

      {awsAuthError && <Alert type="error" style={{ whiteSpace: "pre-line" }}>{awsAuthError}</Alert>}

      <div className="form-section" style={{ opacity: awsLoading ? 0.6 : 1 }}>
        <h3>Authentication Method</h3>
        
        <div className="auth-mode-selector">
          <label className="radio-label">
            <input
              type="radio"
              checked={awsAuthMode === "profile"}
              onChange={() => {
                setAwsAuthMode("profile");
                setShowPermissionWarning(false);
                setPermissionWarningAcknowledged(false);
              }}
            />
            Use AWS CLI Profile (recommended)
          </label>
          <label className="radio-label">
            <input
              type="radio"
              checked={awsAuthMode === "keys"}
              onChange={() => {
                setAwsAuthMode("keys");
                setShowPermissionWarning(false);
                setPermissionWarningAcknowledged(false);
              }}
            />
            Use Access Key Credentials
          </label>
        </div>

        {awsAuthMode === "profile" && (
          <>
            <Alert type="info" style={{ marginBottom: "16px" }}>
              <strong>How to set up AWS CLI profiles:</strong>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "13px" }}>
                <li>Install the <a href="https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>AWS CLI</a>.</li>
                <li>Run <code>aws configure</code> (for access keys) or <code>aws configure sso</code> (for SSO).</li>
                <li>Enter your credentials when prompted.</li>
              </ol>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#888" }}>
                Profiles are stored in <code>~/.aws/config</code> and <code>~/.aws/credentials</code>.{" "}
                <a href="https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>
                  Learn more →
                </a>
              </p>
            </Alert>
            {awsProfiles.length === 0 ? (
              <Alert type="warning">
                <strong>No AWS profiles found.</strong>
                <p style={{ margin: "8px 0 0 0", fontSize: "13px" }}>
                  Please set up AWS CLI following the instructions above, or switch to "Use Access Keys".
                </p>
              </Alert>
            ) : (
              <div className="two-column">
                <div className="form-group">
                  <label>AWS Profile</label>
                  <select
                    value={credentials.aws_profile || ""}
                    onChange={(e) => onProfileChange(e.target.value)}
                  >
                    {awsProfiles.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}{p.is_sso ? " (SSO)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <div className="auth-status">
                    {awsLoading && <span className="spinner" />}
                    {awsIdentity && (
                      <span className="success">
                        Account: {awsIdentity.account}
                      </span>
                    )}
                    {awsAuthError && !awsLoading && (
                      <span className="error">{awsAuthError}</span>
                    )}
                    {!awsIdentity && !awsAuthError && !awsLoading && (
                      <span style={{ color: "#888" }}>Click Verify to check credentials.</span>
                    )}
                  </div>
                  <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="btn btn-small btn-secondary"
                      onClick={() => onCheckIdentity(credentials.aws_profile || "default")}
                      disabled={awsLoading}
                    >
                      {awsLoading ? "Verifying..." : "Verify"}
                    </button>
                    {awsProfiles.find(p => p.name === credentials.aws_profile)?.is_sso && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={onSsoLogin}
                        disabled={awsLoading}
                      >
                        SSO Login
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {awsIdentity && (
              <Alert type="success" style={{ marginTop: "16px" }}>
                Authenticated as: <strong>{awsIdentity.arn}</strong>
              </Alert>
            )}
          </>
        )}

        {awsAuthMode === "keys" && (
          <>
            <Alert type="info" style={{ marginBottom: "16px" }}>
              <strong>How to get AWS access keys:</strong>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "13px" }}>
                <li>Go to <a href="https://console.aws.amazon.com/iam/home#/security_credentials" target="_blank" rel="noopener noreferrer" style={{ color: "#ff6b35" }}>AWS IAM Console → Security Credentials</a>.</li>
                <li>Click "Create access key" under Access Keys section.</li>
                <li>Copy the Access Key ID and Secret Access Key.</li>
              </ol>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#ffb347" }}>
                ⚠️ Access keys are long-lived credentials. Consider using AWS CLI profiles with SSO for better security.
              </p>
            </Alert>
            <div className="two-column">
              <div className="form-group">
                <label>AWS Access Key ID *</label>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={credentials.aws_access_key_id || ""}
                  onChange={(e) => handleCredentialChange("aws_access_key_id", e.target.value)}
                  placeholder="AKIA..."
                />
              </div>
              <div className="form-group">
                <label>AWS Secret Access Key *</label>
                <PasswordInput
                  value={credentials.aws_secret_access_key || ""}
                  onChange={(e) => handleCredentialChange("aws_secret_access_key", e.target.value)}
                  placeholder="Enter secret key"
                />
              </div>
            </div>
            <div className="form-group">
              <label>AWS Session Token (optional)</label>
              <PasswordInput
                value={credentials.aws_session_token || ""}
                onChange={(e) => handleCredentialChange("aws_session_token", e.target.value)}
                placeholder="For temporary credentials"
              />
              <div className="help-text">Only needed for temporary credentials (e.g., from STS AssumeRole).</div>
            </div>
          </>
        )}
      </div>

      {showPermissionWarning && awsPermissionCheck && !awsPermissionCheck.has_all_permissions && (
        <PermissionWarningDialog
          cloud="aws"
          permissionCheck={awsPermissionCheck}
          acknowledged={permissionWarningAcknowledged}
          onAcknowledgeChange={setPermissionWarningAcknowledged}
        />
      )}

      <div className="mt-32">
        <button 
          className="btn" 
          onClick={showPermissionWarning ? onContinueWithWarning : onValidateAndContinue} 
          disabled={!canContinue || checkingPermissions || awsLoading || (showPermissionWarning && !permissionWarningAcknowledged)}
        >
          {awsLoading ? (
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
        {validationAttempted && awsAuthError && (
          <div className="mt-8 text-sm text-error">
            Validation failed - see error details above
          </div>
        )}
      </div>
    </div>
  );
}
