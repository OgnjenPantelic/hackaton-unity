import { useState } from "react";
import { useWizard } from "../../hooks/useWizard";

export function UnityCatalogConfigScreen() {
  const ctx = useWizard();
  const {
    selectedCloud, formValues,
    ucConfig, setUcConfig,
    ucPermissionCheck,
    ucPermissionAcknowledged, setUcPermissionAcknowledged,
    ucCheckLoading, ucCheckError,
    loading, generateStorageName,
    refreshUCPermissions: onRefreshPermissions,
    startDeploymentWizard: onStartDeployment,
    goBack: onBack,
  } = ctx;
  const region = formValues.region || formValues.location || formValues.google_region || "";
  const workspaceName = formValues.workspace_name || formValues.databricks_workspace_name || formValues.prefix || "workspace";
  
  const metastoreExists = ucPermissionCheck?.metastore.exists;
  
  const needsAcknowledgment = ucConfig.enabled && metastoreExists;
  const canProceed = !ucConfig.enabled || (
    ucConfig.catalog_name.trim() !== "" && 
    ucConfig.storage_name.trim() !== "" &&
    (!needsAcknowledgment || ucPermissionAcknowledged)
  );
  const metastoreName = ucPermissionCheck?.metastore.metastore_name;
  const metastoreId = ucPermissionCheck?.metastore.metastore_id;
  const [catalogFormatted, setCatalogFormatted] = useState(false);
  const [storageFormatted, setStorageFormatted] = useState(false);

  return (
    <div className="container">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h1>Unity Catalog Setup</h1>
      <p className="subtitle">
        Configure Unity Catalog for your workspace.
      </p>

      {ucCheckError && <div className="alert alert-error">{ucCheckError}</div>}

      {/* Metastore Status - Always visible at top */}
      <div className={`form-section ${selectedCloud}`}>
        <h3>Metastore</h3>
        
        {ucCheckLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0" }}>
            <span className="spinner" />
            Detecting metastore in {region}...
          </div>
        ) : ucPermissionCheck ? (
          <div>
            {metastoreExists ? (
              <div style={{ 
                padding: "12px 16px", 
                backgroundColor: "rgba(46, 204, 113, 0.1)", 
                borderRadius: "6px",
                borderLeft: "3px solid #2ecc71"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ color: "#2ecc71" }}>✓</span>
                  <strong>Existing Metastore Found</strong>
                </div>
                <div style={{ fontSize: "0.9em", color: "#aaa", marginLeft: "24px" }}>
                  <div>{metastoreName}</div>
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "2px" }}>
                    ID: {metastoreId}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ 
                padding: "12px 16px", 
                backgroundColor: "rgba(52, 152, 219, 0.1)", 
                borderRadius: "6px",
                borderLeft: "3px solid #3498db"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ color: "#3498db" }}>ℹ</span>
                  <strong>No Metastore in Region</strong>
                </div>
                <div style={{ fontSize: "0.9em", color: "#aaa", marginLeft: "24px" }}>
                  A new metastore will be created in {region}. As the creator, you'll be Metastore Admin.
                </div>
              </div>
            )}
            
            <button 
              className="btn btn-small btn-secondary"
              onClick={onRefreshPermissions}
              style={{ marginTop: "12px" }}
            >
              Refresh
            </button>
          </div>
        ) : (
          <div style={{ color: "#888" }}>
            Unable to detect metastore. You can still proceed.
          </div>
        )}
      </div>

      {/* Catalog Configuration */}
      <div className={`form-section ${selectedCloud}`}>
        <h3 style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label className="checkbox-label" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={ucConfig.enabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                const catalogNameFromWorkspace = workspaceName
                  .toLowerCase()
                  .replace(/-/g, "_")
                  .replace(/[^a-z0-9_]/g, "") + "_catalog";
                setUcConfig(prev => ({
                  ...prev,
                  enabled,
                  catalog_name: enabled && !prev.catalog_name ? catalogNameFromWorkspace : prev.catalog_name,
                  storage_name: enabled && !prev.storage_name ? generateStorageName() : prev.storage_name,
                }));
                if (!enabled) {
                  setUcPermissionAcknowledged(false);
                }
              }}
            />
            Create a new Catalog for this workspace
          </label>
        </h3>
        
        {ucConfig.enabled && (
          <>
            {/* Permission warning - only show when metastore exists */}
            {metastoreExists && (
              <div className="alert alert-warning" style={{ marginBottom: "16px" }}>
                <strong>Permissions Required</strong>
                <br />
                <span style={{ fontSize: "0.9em" }}>
                  {ucPermissionCheck?.message}
                </span>
                <div style={{ 
                  marginTop: "8px", 
                  padding: "8px", 
                  backgroundColor: "rgba(0,0,0,0.2)", 
                  borderRadius: "4px",
                  fontSize: "0.85em"
                }}>
                  Required: CREATE CATALOG, CREATE STORAGE CREDENTIAL, CREATE EXTERNAL LOCATION
                </div>
                
                {/* Acknowledgment checkbox */}
                <label 
                  className="checkbox-label" 
                  style={{ 
                    marginTop: "12px", 
                    display: "flex", 
                    alignItems: "flex-start",
                    gap: "8px",
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={ucPermissionAcknowledged}
                    onChange={(e) => setUcPermissionAcknowledged(e.target.checked)}
                    style={{ marginTop: "2px" }}
                  />
                  <span style={{ fontSize: "0.9em" }}>
                    I confirm I have the required permissions on this metastore
                  </span>
                </label>
              </div>
            )}

            <div className="alert alert-info" style={{ marginBottom: "16px" }}>
              <strong>Isolated Storage Mode</strong>
              <br />
              <span style={{ fontSize: "0.9em" }}>
                This will create a dedicated {selectedCloud === "aws" ? "S3 bucket" : selectedCloud === "gcp" ? "GCS bucket" : "Azure Storage account"} for your catalog, 
                providing workspace-isolated data storage (recommended for production).
              </span>
            </div>

            <div className="form-group" style={{ marginTop: "16px" }}>
              <label>Catalog Name *</label>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={ucConfig.catalog_name}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  if (cleaned !== raw) {
                    setCatalogFormatted(true);
                    setTimeout(() => setCatalogFormatted(false), 2000);
                  }
                  setUcConfig(prev => ({ ...prev, catalog_name: cleaned }));
                }}
                placeholder="e.g., main_catalog"
              />
            <div className="help-text">
              Lowercase letters, numbers, and underscores only.
              {catalogFormatted && (
                <span style={{ color: "var(--accent)", marginLeft: "8px" }}>Auto-formatted</span>
              )}
            </div>
              {selectedCloud === "gcp" && (
                <div className="warning-box" style={{ 
                  marginTop: "8px", 
                  padding: "8px 12px", 
                  background: "rgba(255, 193, 7, 0.15)", 
                  border: "1px solid rgba(255, 193, 7, 0.3)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  color: "var(--text-secondary)"
                }}>
                  <strong style={{ color: "var(--text-primary)" }}>Note:</strong> If your metastore has auto-catalog provisioning enabled, 
                  a catalog matching the workspace name may be created automatically. 
                  Using a different name (e.g., adding <code>_catalog</code> suffix) avoids conflicts.
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginTop: "16px" }}>
              <label>
                {selectedCloud === "aws" ? "New S3 Bucket Name" : selectedCloud === "gcp" ? "New GCS Bucket Name" : "New Storage Account Name"} *
              </label>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={ucConfig.storage_name}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cleaned = selectedCloud === "gcp"
                    ? raw.toLowerCase().replace(/[^a-z0-9-]/g, "")
                    : raw.toLowerCase().replace(/[^a-z0-9]/g, "");
                  if (cleaned !== raw) {
                    setStorageFormatted(true);
                    setTimeout(() => setStorageFormatted(false), 2000);
                  }
                  setUcConfig(prev => ({ ...prev, storage_name: cleaned }));
                }}
                placeholder={selectedCloud === "aws" ? "e.g., mycompany-databricks-uc" : selectedCloud === "gcp" ? "e.g., mycompany-databricks-uc" : "e.g., mycompanydbuc"}
              />
              <div className="help-text">
                {selectedCloud === "aws" 
                  ? "A new S3 bucket will be created for this catalog. Must be globally unique (3-63 characters)."
                  : selectedCloud === "gcp"
                  ? "A new GCS bucket will be created for this catalog. Must be globally unique (3-63 characters, lowercase letters, numbers, and hyphens)."
                  : "A new Storage Account will be created for this catalog. Must be globally unique (3-24 characters)."
                }
                {storageFormatted && (
                  <span style={{ color: "var(--accent)", marginLeft: "8px" }}>Auto-formatted</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Continue Button */}
      <div style={{ marginTop: "32px", display: "flex", alignItems: "center", gap: "16px" }}>
        <button 
          className="btn btn-large btn-success" 
          onClick={onStartDeployment}
          disabled={!canProceed || loading}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Preparing...
            </>
          ) : (
            "Create Workspace →"
          )}
        </button>
        {!canProceed && ucConfig.enabled && (
          <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>
            Fill in all required fields to continue
          </span>
        )}
      </div>
      {ucConfig.enabled && !ucPermissionCheck?.can_create_catalog && ucPermissionCheck?.metastore.exists && (
        <p style={{ marginTop: "12px", color: "#e67e22", fontSize: "0.9em" }}>
          You may not have sufficient permissions. The workspace will be created, but catalog creation may fail.
        </p>
      )}
      {!ucConfig.enabled && (
        <p style={{ marginTop: "12px", color: "var(--text-muted)", fontSize: "0.9em" }}>
          Catalog setup is optional. You can create catalogs later through the Databricks workspace.
        </p>
      )}
    </div>
  );
}
