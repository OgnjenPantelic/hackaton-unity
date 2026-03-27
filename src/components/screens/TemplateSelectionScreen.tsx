import { invoke } from "@tauri-apps/api/core";
import { CLOUDS } from "../../constants";
import { useWizard } from "../../hooks/useWizard";

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export function TemplateSelectionScreen() {
  const { templates, selectedCloud, loadingTemplate, selectTemplate, goBack } = useWizard();
  const cloudTemplates = templates.filter((t) => t.cloud === selectedCloud);

  const handleKeyDown = (e: React.KeyboardEvent, template: typeof cloudTemplates[0]) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectTemplate(template);
    }
  };

  return (
    <div className="container">
      <button className="back-btn" onClick={goBack} disabled={!!loadingTemplate}>
        ← Back
      </button>
      <h1>Select Template</h1>
      <p className="subtitle">
        Choose the security and networking configuration that best fits your requirements.
      </p>

      {loadingTemplate && (
        <div className="loading-overlay">
          <div className="loading-content">
            <span className="spinner large" />
            <div>Loading template configuration...</div>
          </div>
        </div>
      )}

      <div className="templates">
        {cloudTemplates.length === 0 ? (
          <div className="template-card" style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <div className="coming-soon">Coming Soon</div>
            <div className="template-title">
              {selectedCloud === CLOUDS.GCP ? "GCP Standard Workspace" : "Standard Workspace"}
            </div>
            <div className="template-description">
              Templates for this cloud provider are not yet available.
            </div>
          </div>
        ) : (
          <>
            {cloudTemplates.map((template) => {
              const inDev = template.id === "gcp-sra" || template.id === "aws-sra" || template.id === "azure-sra";
              const isLoading = loadingTemplate === template.id;
              const disabled = inDev || !!loadingTemplate;
              return (
                <div
                  key={template.id}
                  className={`template-card${isLoading ? " selected" : ""}${disabled ? " disabled" : ""}`}
                  onClick={disabled ? undefined : () => selectTemplate(template)}
                  onKeyDown={disabled ? undefined : (e) => handleKeyDown(e, template)}
                  tabIndex={disabled ? -1 : 0}
                  role="button"
                  aria-label={`Select ${template.name} template`}
                  style={inDev ? { opacity: 0.5, cursor: "not-allowed", position: "relative" } : undefined}
                >
                  {inDev && (
                    <div style={{
                      position: "absolute", top: "12px", right: "12px",
                      background: "#f59e0b", color: "#000", fontSize: "11px", fontWeight: 700,
                      padding: "3px 10px", borderRadius: "4px", letterSpacing: "0.5px",
                    }}>
                      IN DEVELOPMENT
                    </div>
                  )}
                  <div className="template-title">
                    {template.name}
                    {template.id.endsWith("-simple") && (
                      <span style={{
                        fontSize: "12px", fontWeight: 500, color: "var(--success)",
                        marginLeft: "8px", opacity: 0.85,
                      }}>(Default)</span>
                    )}
                  </div>
                  <div className="template-description">{template.description}</div>
                  <div className="template-features">
                    <ul>
                      {template.features.map((feature, i) => (
                        <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                          <CheckIcon />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <a
                    href={template.github_url}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      invoke("open_url", { url: template.github_url }).catch(() => {});
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      marginTop: "12px", fontSize: "12px", color: "var(--text-secondary)",
                      textDecoration: "none", opacity: 0.75, transition: "opacity 0.15s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
                  >
                    <GitHubIcon />
                    View Terraform source on GitHub
                  </a>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
