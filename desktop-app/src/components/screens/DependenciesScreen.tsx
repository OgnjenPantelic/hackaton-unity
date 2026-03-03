import React, { useState } from 'react';
import { CLOUDS, CLOUD_DISPLAY_NAMES } from '../../constants';
import { useWizard } from '../../hooks/useWizard';

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" strokeWidth="2" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const MinusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const DependenciesScreen: React.FC = () => {
  const {
    dependencies,
    selectedCloud,
    error,
    installingTerraform,
    installTerraform,
    recheckDependencies,
    continueFromDependencies,
    goBack,
  } = useWizard();
  const [rechecking, setRechecking] = useState(false);

  const terraformDep = dependencies["terraform"];
  const gitDep = dependencies["git"];
  const canContinue = terraformDep?.installed && gitDep?.installed;
  
  const cloudCliKey = selectedCloud === CLOUDS.AWS ? "aws" : selectedCloud === CLOUDS.AZURE ? "azure" : "gcloud";
  const cloudCliDep = dependencies[cloudCliKey];
  const cloudCliName = selectedCloud === CLOUDS.AWS ? "AWS CLI" : selectedCloud === CLOUDS.AZURE ? "Azure CLI" : "Google Cloud CLI";
  const databricksCli = dependencies["databricks"];

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      await recheckDependencies();
    } finally {
      setRechecking(false);
    }
  };

  const StatusIcon = ({ installed, optional }: { installed?: boolean; optional?: boolean }) => {
    if (installed) return <CheckIcon />;
    if (optional) return <MinusIcon />;
    return <XIcon />;
  };

  return (
    <div className="container">
      <button className="back-btn" onClick={goBack}>
        ← Back
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>System Requirements for {CLOUD_DISPLAY_NAMES[selectedCloud] || selectedCloud}</h1>
          <p className="subtitle">
            Let's make sure your system has everything needed for your {CLOUD_DISPLAY_NAMES[selectedCloud] || selectedCloud} deployment.
          </p>
        </div>
        <button
          className="btn btn-secondary btn-small"
          onClick={handleRecheck}
          disabled={rechecking}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
        >
          {rechecking ? <span className="spinner" /> : <RefreshIcon />}
          Re-check
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="dependency-list">
        <div className="dependency-item">
          <div className="dependency-info">
            <StatusIcon installed={terraformDep?.installed} />
            <div>
              <div className="dependency-name">Terraform</div>
              {terraformDep?.version && (
                <div className="dependency-version">v{terraformDep.version}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="dependency-badge required">Required</span>
            {!terraformDep?.installed && (
              <button
                className="btn"
                onClick={installTerraform}
                disabled={installingTerraform}
              >
                {installingTerraform ? (
                  <>
                    <span className="spinner" />
                    Installing...
                  </>
                ) : (
                  "Install"
                )}
              </button>
            )}
          </div>
        </div>

        <div className="dependency-item">
          <div className="dependency-info">
            <StatusIcon installed={gitDep?.installed} />
            <div>
              <div className="dependency-name">Git</div>
              {gitDep?.version && (
                <div className="dependency-version">{gitDep.version}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="dependency-badge required">Required</span>
            {!gitDep?.installed && (
              <a href={gitDep?.install_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-small">
                Install Guide
              </a>
            )}
          </div>
        </div>

        <div className="dependency-item">
          <div className="dependency-info">
            <StatusIcon installed={cloudCliDep?.installed} optional />
            <div>
              <div className="dependency-name">{cloudCliName}</div>
              {cloudCliDep?.version && (
                <div className="dependency-version">{cloudCliDep.version}</div>
              )}
              {!cloudCliDep?.installed && (
                <div className="dependency-note">
                  {selectedCloud === CLOUDS.AWS 
                    ? "Enables profile-based authentication and SSO."
                    : "Enables interactive login and profile-based authentication."}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="dependency-badge">Optional</span>
            {!cloudCliDep?.installed && (
              <a href={cloudCliDep?.install_url} target="_blank" className="btn btn-secondary btn-small">
                Install Guide
              </a>
            )}
          </div>
        </div>

        <div className="dependency-item">
          <div className="dependency-info">
            <StatusIcon installed={databricksCli?.installed} optional />
            <div>
              <div className="dependency-name">Databricks CLI</div>
              {databricksCli?.version && (
                <div className="dependency-version">{databricksCli.version}</div>
              )}
              {!databricksCli?.installed && (
                <div className="help-text">Enables profile-based authentication (OAuth or service principal).</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="dependency-badge">Optional</span>
            {!databricksCli?.installed && (
              <a href={databricksCli?.install_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-small">
                Install Guide
              </a>
            )}
          </div>
        </div>
      </div>

        {!terraformDep?.installed && (
          <div className="alert alert-warning">
            Terraform is required to deploy workspaces. Click "Install" above to automatically download and install it, or install it manually from{" "}
            <a href={terraformDep?.install_url} target="_blank" rel="noopener noreferrer" style={{ color: "#ffb347" }}>
              terraform.io
            </a>.
          </div>
        )}

        <div className="alert alert-info">
          <strong>Optional tools:</strong>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "14px" }}>
            <li>
              <strong>{cloudCliName}</strong>: If installed, credentials will be auto-detected. Otherwise, you can enter them manually in the next steps.
            </li>
            <li>
              <strong>Databricks CLI</strong>: If installed, enables profile-based OAuth authentication. Otherwise, you can use service principal credentials.
            </li>
          </ul>
        </div>

      <div style={{ marginTop: "32px", display: "flex", alignItems: "center", gap: "16px" }}>
        <button className="btn" onClick={continueFromDependencies} disabled={!canContinue}>
          Continue →
        </button>
        {!canContinue && (
          <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
            Install all required dependencies to continue
          </span>
        )}
      </div>
    </div>
  );
};

export default DependenciesScreen;
