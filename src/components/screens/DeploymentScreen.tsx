import { useMemo, useState, useEffect, useRef } from "react";
import { useWizard } from "../../hooks/useWizard";
import type { DeploymentStep } from "../../hooks/useDeployment";
import { GitIntegrationCard } from "../GitIntegrationCard";

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Go Back</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text, onCopy }: { text: string; onCopy: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  const handleClick = () => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="copy-btn-wrapper">
      <button
        onClick={handleClick}
        title="Copy"
        style={{
          background: "transparent", border: "none", color: "#6b7280",
          cursor: "pointer", fontSize: "14px", padding: "4px",
          opacity: 0.7, transition: "opacity 0.15s"
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "0.7")}
      >
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {copied && <span className="copy-feedback">Copied!</span>}
    </span>
  );
}

function formatTerraformOutput(output: string): React.ReactNode[] {
  return output.split("\n").map((line, i) => {
    let cls = "tf-info";
    if (/^\s*\+/.test(line) || /Creation complete/.test(line)) cls = "tf-add";
    else if (/^\s*-/.test(line) || /Destroying|Destruction complete/.test(line)) cls = "tf-destroy";
    else if (/^\s*~/.test(line) || /Modifying/.test(line)) cls = "tf-change";
    else if (/Error:|╷|│|╵/.test(line) || /error\b/i.test(line)) cls = "tf-error";
    return <div key={i} className={cls}>{line}</div>;
  });
}

function useElapsedTimer(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ── Resource Timeline ──────────────────────────────────────────────────

interface ResourceEntry {
  id: string;
  status: "pending" | "creating" | "created" | "imported" | "destroying" | "destroyed";
  duration?: string;
}

interface TimelineData {
  resources: ResourceEntry[];
  plannedToCreate: number;
  plannedToDestroy: number;
  createdCount: number;
  destroyedCount: number;
}

function useResourceTimeline(output: string | undefined): TimelineData | null {
  return useMemo(() => {
    if (!output) return null;
    const lines = output.split("\n");

    const planned = new Set<string>();
    const plannedDestroy = new Set<string>();
    const creating = new Set<string>();
    const created = new Map<string, string>();
    const imported = new Map<string, boolean>();
    const destroying = new Set<string>();
    const destroyed = new Map<string, string>();

    for (const line of lines) {
      const willCreate = line.match(/^#\s+(\S+)\s+will be created/);
      if (willCreate) { planned.add(willCreate[1]); continue; }

      const willDestroy = line.match(/^#\s+(\S+)\s+will be destroyed/);
      if (willDestroy) { plannedDestroy.add(willDestroy[1]); continue; }

      const willUpdate = line.match(/^#\s+(\S+)\s+will be updated/);
      if (willUpdate) { planned.add(willUpdate[1]); continue; }

      const importedMatch = line.match(/^\[IMPORTED\]\s+(\S+)/);
      if (importedMatch) {
        imported.set(importedMatch[1], true);
        continue;
      }

      const creatingMatch = line.match(/^([^:]+):\s*Creating\.\.\./);
      if (creatingMatch) {
        const name = creatingMatch[1].trim();
        creating.add(name);
        planned.add(name);
        continue;
      }

      const createdMatch = line.match(/^([^:]+):\s*Creation complete after\s*(\S+)/);
      if (createdMatch) {
        const name = createdMatch[1].trim();
        created.set(name, createdMatch[2]);
        creating.delete(name);
        planned.add(name);
        continue;
      }

      const createdNoDuration = line.match(/^([^:]+):\s*Creation complete/);
      if (createdNoDuration && !createdMatch) {
        const name = createdNoDuration[1].trim();
        created.set(name, "");
        creating.delete(name);
        planned.add(name);
        continue;
      }

      const destroyingMatch = line.match(/^([^:]+):\s*Destroying\.\.\./);
      if (destroyingMatch) {
        const name = destroyingMatch[1].trim();
        destroying.add(name);
        plannedDestroy.add(name);
        continue;
      }

      const destroyedMatch = line.match(/^([^:]+):\s*Destruction complete after\s*(\S+)/);
      if (destroyedMatch) {
        const name = destroyedMatch[1].trim();
        destroyed.set(name, destroyedMatch[2]);
        destroying.delete(name);
        plannedDestroy.add(name);
        continue;
      }

      const destroyedNoDuration = line.match(/^([^:]+):\s*Destruction complete/);
      if (destroyedNoDuration && !destroyedMatch) {
        const name = destroyedNoDuration[1].trim();
        destroyed.set(name, "");
        destroying.delete(name);
        plannedDestroy.add(name);
        continue;
      }
    }

    // Use the last Plan: line so the denominator reflects the latest retry
    const planMatches = [...output.matchAll(/Plan:\s*(\d+)\s*to add,\s*(\d+)\s*to change,\s*(\d+)\s*to destroy/g)];
    const planMatch = planMatches.length > 0 ? planMatches[planMatches.length - 1] : null;
    const plannedTotal = planMatch ? parseInt(planMatch[1], 10) + parseInt(planMatch[2], 10) : planned.size;
    const plannedDestroyTotal = planMatch ? parseInt(planMatch[3], 10) : plannedDestroy.size;

    const isDestroying = destroying.size > 0 || destroyed.size > 0;
    let resources: ResourceEntry[];

    if (isDestroying && creating.size === 0 && created.size === 0) {
      resources = [];
      for (const [name, dur] of destroyed) {
        resources.push({ id: name, status: "destroyed", duration: dur || undefined });
      }
      for (const name of destroying) {
        resources.push({ id: name, status: "destroying" });
      }
      for (const name of plannedDestroy) {
        if (!destroying.has(name) && !destroyed.has(name)) {
          resources.push({ id: name, status: "pending" });
        }
      }
    } else {
      resources = [];
      for (const name of imported.keys()) {
        if (!created.has(name)) {
          resources.push({ id: name, status: "imported" });
        }
      }
      for (const [name, dur] of created) {
        resources.push({ id: name, status: "created", duration: dur || undefined });
      }
      for (const name of creating) {
        resources.push({ id: name, status: "creating" });
      }
      for (const name of planned) {
        if (!creating.has(name) && !created.has(name) && !imported.has(name)) {
          resources.push({ id: name, status: "pending" });
        }
      }
    }

    if (resources.length === 0) return null;

    return {
      resources,
      plannedToCreate: plannedTotal,
      plannedToDestroy: plannedDestroyTotal,
      createdCount: created.size + imported.size,
      destroyedCount: destroyed.size,
    };
  }, [output]);
}

function formatResourceName(id: string): string {
  const parts = id.split(".");
  if (parts.length >= 2) {
    const type = parts.slice(0, -1).join(".");
    const name = parts[parts.length - 1];
    return `${type}.${name}`;
  }
  return id;
}

const ResourceRowIcon = ({ status }: { status: ResourceEntry["status"] }) => {
  if (status === "imported") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "created" || status === "destroyed") {
    const color = status === "created" ? "var(--success)" : "var(--error)";
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "creating" || status === "destroying") {
    return <span className="spinner resource-spinner" />;
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
};

function ResourceTimeline({ resources, total, completed, isRollingBack }: {
  resources: ResourceEntry[];
  total: number;
  completed: number;
  isRollingBack: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCompletedRef = useRef(0);

  useEffect(() => {
    if (completed > prevCompletedRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const activeRow = container.querySelector(".resource-row.creating, .resource-row.destroying");
      if (activeRow) {
        activeRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    prevCompletedRef.current = completed;
  }, [completed, resources.length]);

  const activeAndDone = resources.filter(r => r.status !== "pending");
  const pending = resources.filter(r => r.status === "pending");
  const pendingPreview = pending.slice(0, 3);
  const pendingRemaining = pending.length - pendingPreview.length;

  return (
    <div className={`resource-timeline ${isRollingBack ? "rollback" : ""}`}>
      <div className="resource-timeline-header">
        <span className="resource-timeline-title">Resource Progress</span>
        <span className="resource-timeline-count">{completed} / {total}</span>
      </div>
      <div className="resource-timeline-list" ref={scrollRef}>
        {activeAndDone.map((r, i) => (
          <div
            key={r.id}
            className={`resource-row ${r.status}`}
            style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}
          >
            <ResourceRowIcon status={r.status} />
            <span className="resource-row-name">{formatResourceName(r.id)}</span>
            <span className="resource-row-status">
              {r.status === "creating" && "Creating..."}
              {r.status === "created" && "Created"}
              {r.status === "imported" && "Imported"}
              {r.status === "destroying" && "Destroying..."}
              {r.status === "destroyed" && "Destroyed"}
            </span>
            {r.duration && <span className="resource-row-duration">{r.duration}</span>}
          </div>
        ))}
        {pendingPreview.map((r) => (
          <div key={r.id} className="resource-row pending">
            <ResourceRowIcon status="pending" />
            <span className="resource-row-name">{formatResourceName(r.id)}</span>
            <span className="resource-row-status">Pending</span>
          </div>
        ))}
        {pendingRemaining > 0 && (
          <div className="resource-row-remaining">
            {pendingRemaining} more pending...
          </div>
        )}
      </div>
    </div>
  );
}

export function DeploymentScreen() {
  const ctx = useWizard();
  const {
    deployment,
    error,
    startDeploymentWizard: onStartDeployment,
    confirmAndDeploy: onConfirmDeploy,
    cancelDeployment: onCancel,
    rollback: onRollback,
    resetToWelcome: onResetToWelcome,
    copyToClipboard,
    setScreen,
    goBack: onGoBack,
    selectedTemplate,
  } = ctx;
  const deploymentStep = deployment.deploymentStep;
  const setDeploymentStep = deployment.setDeploymentStep;
  const deploymentStatus = deployment.deploymentStatus;
  const showDetailedLogs = deployment.showDetailedLogs;
  const setShowDetailedLogs = deployment.setShowDetailedLogs;
  const isRollingBack = deployment.isRollingBack;
  const isSraTemplate = selectedTemplate?.id?.includes("sra") ?? false;
  const templatePath = deployment.templatePath;
  const onOpenTemplateFolder = deployment.openTemplateFolder;
  const onGoToUcConfig = () => setScreen("unity-catalog-config");
  const status = deploymentStatus;

  const [confirmAction, setConfirmAction] = useState<"cancel" | "rollback" | "newDeployment" | "newDeploymentAfterSuccess" | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const isWorking = deploymentStep === "initializing" || deploymentStep === "planning" || deploymentStep === "deploying";

  useEffect(() => {
    if (deploymentStep === "failed") {
      setShowDetailedLogs(true);
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 200);
    }
  }, [deploymentStep]);
  const elapsedStr = useElapsedTimer(isWorking);
  
  const getCatalogExistsError = (output: string | undefined): string | null => {
    if (!output) return null;
    const match = output.match(/Catalog ['"]([^'"]+)['"] already exists/);
    return match ? match[1] : null;
  };

  const timeline = useResourceTimeline(status?.output);

  const resourceCounts = useMemo(() => {
    if (!timeline) return null;
    return {
      creating: timeline.resources.filter(r => r.status === "creating").length,
      created: timeline.createdCount,
      destroying: timeline.resources.filter(r => r.status === "destroying").length,
      destroyed: timeline.destroyedCount,
      plannedToCreate: timeline.plannedToCreate,
      plannedToDestroy: timeline.plannedToDestroy,
    };
  }, [timeline]);

  const parsedOutputs = useMemo(() => {
    if (!status?.output) return {};
    const outputs: Record<string, string> = {};
    for (const line of status.output.split('\n')) {
      const match = line.match(/^(\w+)\s*=\s*"([^"]*)"$/);
      if (match) outputs[match[1]] = match[2];
    }
    return outputs;
  }, [status?.output]);
  
  const stepInfo: Record<DeploymentStep, { title: string; description: string }> = {
    ready: { title: "Ready to Deploy", description: "Click below to start the deployment process." },
    initializing: { title: "Preparing Environment", description: "Setting up Terraform and downloading required providers..." },
    planning: { title: "Analyzing Changes", description: "Determining what resources will be created..." },
    review: { title: "Review & Confirm", description: "Enable 'Show detailed logs' below to review the planned changes, then confirm to proceed." },
    deploying: isRollingBack 
      ? { title: "Cleaning Up Resources", description: "Removing deployed resources. This may take several minutes..." }
      : { title: "Creating Workspace", description: isSraTemplate
          ? "Deploying your SRA workspace. Typical time: 20-40 minutes."
          : "Deploying your Databricks workspace. Typical time: 10-15 minutes." },
    complete: isRollingBack
      ? { title: "Cleanup Complete!", description: "All resources have been successfully removed." }
      : { title: "Deployment Complete!", description: "Your Databricks workspace has been successfully created." },
    failed: { title: "Deployment Failed", description: "An error occurred. Review the logs below for details." },
  };

  const currentStepInfo = stepInfo[deploymentStep];

  return (
    <div className="container">
      {confirmAction === "cancel" && (
        <ConfirmDialog
          title={isRollingBack ? "Cancel Cleanup?" : "Cancel Deployment?"}
          message={isRollingBack
            ? "Cancelling mid-cleanup can leave resources in an inconsistent state, with some removed and others still remaining. It is recommended to wait for the cleanup to complete."
            : "Cancelling mid-deployment can leave resources in an inconsistent state. It is recommended to wait for the deployment to complete and then clean up if needed."}
          confirmLabel="Yes, Cancel"
          onConfirm={() => { setConfirmAction(null); onCancel(); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "rollback" && (
        <ConfirmDialog
          title="Delete Workspace & Resources?"
          message="This will destroy all resources created by this deployment. This action cannot be undone."
          confirmLabel="Yes, Delete All"
          onConfirm={() => { setConfirmAction(null); onRollback(); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "newDeployment" && (
        <ConfirmDialog
          title="Start New Deployment?"
          message="This will clear the current configuration and return to the welcome screen. Any partially created resources from the failed deployment will remain."
          confirmLabel="Yes, Start New"
          onConfirm={() => { setConfirmAction(null); onResetToWelcome(); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "newDeploymentAfterSuccess" && (
        <ConfirmDialog
          title="Start New Deployment?"
          message="This will clear the current configuration and return to the welcome screen. Your deployed resources will not be affected."
          confirmLabel="Yes, Start New"
          onConfirm={() => { setConfirmAction(null); onResetToWelcome(true); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {!isWorking && deploymentStep !== "complete" && (
        <button className="back-btn" onClick={onGoBack}>
          ← Back
        </button>
      )}
      
      {/* Progress indicator */}
      <div className="wizard-progress">
        <div className={`wizard-step ${deploymentStep === "initializing" || deploymentStep === "planning" || deploymentStep === "review" || deploymentStep === "deploying" || deploymentStep === "complete" ? "active" : ""} ${deploymentStep === "failed" ? "failed" : ""}`}>
          <div className="wizard-step-number">1</div>
          <div className="wizard-step-label">Prepare</div>
        </div>
        <div className="wizard-connector" />
        <div className={`wizard-step ${deploymentStep === "review" || deploymentStep === "deploying" || deploymentStep === "complete" ? "active" : ""}`}>
          <div className="wizard-step-number">2</div>
          <div className="wizard-step-label">Review</div>
        </div>
        <div className="wizard-connector" />
        <div className={`wizard-step ${deploymentStep === "deploying" || deploymentStep === "complete" ? "active" : ""}`}>
          <div className="wizard-step-number">3</div>
          <div className="wizard-step-label">{isRollingBack ? "Cleanup" : "Deploy"}</div>
        </div>
      </div>

      <div className="deployment-status-card">
        <h1>{currentStepInfo.title}</h1>
        <p className="subtitle">{currentStepInfo.description}</p>
        
        {isWorking && (
          <div className="progress-indicator">
            <span className="spinner large" />
            <div style={{ marginTop: "12px", fontSize: "14px", color: "var(--text-secondary)" }}>
              {deploymentStep === "deploying" && resourceCounts && (resourceCounts.creating > 0 || resourceCounts.destroying > 0) ? (
                isRollingBack 
                  ? `${resourceCounts.destroyed} of ${resourceCounts.plannedToDestroy || resourceCounts.destroying} resources removed`
                  : `${resourceCounts.created} of ${resourceCounts.plannedToCreate || resourceCounts.creating} resources completed`
              ) : null}
              <span style={{ color: "var(--text-muted)", marginLeft: "12px", fontSize: "13px" }}>
                Elapsed: {elapsedStr}
              </span>
            </div>
            {deploymentStep === "deploying" && resourceCounts && (resourceCounts.plannedToCreate > 0 || resourceCounts.plannedToDestroy > 0) && (
              <div className={`deployment-progress-bar ${isRollingBack ? "rollback" : ""}`}>
                <div
                  className="deployment-progress-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      isRollingBack
                        ? (resourceCounts.destroyed / (resourceCounts.plannedToDestroy || 1)) * 100
                        : (resourceCounts.created / (resourceCounts.plannedToCreate || 1)) * 100
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {deploymentStep === "deploying" && timeline && timeline.resources.length > 0 && (
        <ResourceTimeline
          resources={timeline.resources}
          total={isRollingBack ? timeline.plannedToDestroy : timeline.plannedToCreate}
          completed={isRollingBack ? timeline.destroyedCount : timeline.createdCount}
          isRollingBack={isRollingBack}
        />
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ marginTop: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <label className="log-toggle">
          <input
            type="checkbox"
            checked={showDetailedLogs}
            onChange={(e) => setShowDetailedLogs(e.target.checked)}
          />
          Show detailed logs
        </label>
      </div>

      <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center", alignItems: "center" }}>
        {isWorking && (
          <button className="btn btn-danger" onClick={() => setConfirmAction("cancel")}>
            Cancel
          </button>
        )}
        
        {deploymentStep === "review" && (
          <>
            <button className="btn btn-secondary btn-slim" onClick={onGoBack}>
              Go Back & Edit
            </button>
            <button className="btn btn-large btn-success btn-slim" onClick={onConfirmDeploy}>
              Confirm & Deploy →
            </button>
          </>
        )}
      </div>
      {deploymentStep === "review" && templatePath && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "16px" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "12px" }}>or</span>
          <button className="btn-template-folder" onClick={onOpenTemplateFolder}>
            Open Template Folder
          </button>
          <p style={{ fontSize: "12px", color: "#e0e0e0", marginTop: "8px", textAlign: "center", maxWidth: "500px" }}>
            For advanced users: the full Terraform code and generated .tfvars are available in this folder if you prefer to customize and deploy manually.
          </p>
        </div>
      )}
      <div style={{ marginTop: "12px", display: "flex", gap: "12px", justifyContent: "center", alignItems: "center" }}>
        {deploymentStep === "complete" && !isRollingBack && (() => {
          const workspaceUrl = parsedOutputs.workspace_url;
          const metastoreStatus = parsedOutputs.metastore_status;
          const metastoreId = parsedOutputs.metastore_id;
          
          return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: "600px", margin: "0 auto" }}>
              {workspaceUrl && (
                <div style={{
                  background: "linear-gradient(135deg, #1a3a1a 0%, #0d2610 100%)",
                  border: "1px solid #2d5a2d", borderRadius: "12px", padding: "24px",
                  marginBottom: "20px", width: "100%", textAlign: "center"
                }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>
                    Your Workspace
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "16px" }}>
                    <a 
                      href={workspaceUrl.startsWith("http") ? workspaceUrl : `https://${workspaceUrl}`} 
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: "var(--success)", fontSize: "16px", fontWeight: "500", wordBreak: "break-all" }}
                    >
                      {workspaceUrl}
                    </a>
                    <CopyButton text={workspaceUrl} onCopy={copyToClipboard} />
                  </div>
                  <a 
                    href={workspaceUrl.startsWith("http") ? workspaceUrl : `https://${workspaceUrl}`}
                    target="_blank" rel="noopener noreferrer"
                    className="btn btn-success btn-large"
                    style={{ textDecoration: "none", display: "inline-block" }}
                  >
                    Open Workspace →
                  </a>
                </div>
              )}

              {(metastoreStatus || metastoreId) && (
                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px", width: "100%" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "20px" }}>📊</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500" }}>Unity Catalog</div>
                      <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>{metastoreStatus || `Metastore: ${metastoreId}`}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Git Integration */}
              {deployment.deploymentName && (
                <GitIntegrationCard deploymentName={deployment.deploymentName} />
              )}

              <div style={{ display: "flex", gap: "12px", width: "100%", marginBottom: "20px" }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmAction("newDeploymentAfterSuccess")}>
                  Start New Deployment
                </button>
                {templatePath && (
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onOpenTemplateFolder}>
                    Open Folder
                  </button>
                )}
              </div>

              {status?.can_rollback && (
                <button 
                  className="btn" 
                  onClick={() => setConfirmAction("rollback")}
                  style={{ background: "transparent", border: "1px solid #666", color: "var(--text-muted)", fontSize: "13px", padding: "8px 16px" }}
                >
                  Delete Workspace & Resources
                </button>
              )}
            </div>
          );
        })()}
        
        {deploymentStep === "complete" && isRollingBack && (
          <button className="btn" onClick={() => setConfirmAction("newDeploymentAfterSuccess")}>
            Start New Deployment
          </button>
        )}
        
        {deploymentStep === "failed" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
            {(() => {
              const catalogName = getCatalogExistsError(status?.output);
              if (catalogName) {
                return (
                  <div style={{ textAlign: "center", marginBottom: "16px", padding: "12px", background: "var(--bg-tertiary)", borderRadius: "8px", width: "100%", maxWidth: "500px" }}>
                    <p style={{ margin: "0 0 8px 0", color: "var(--text-secondary)" }}>
                      A catalog named <code style={{ color: "var(--text-primary)" }}>{catalogName}</code> already exists 
                      with a different storage location. Go back to change the catalog name or disable Unity Catalog.
                    </p>
                    <button 
                      className="btn btn-primary" style={{ marginTop: "8px" }}
                      onClick={() => { onGoToUcConfig(); setDeploymentStep("ready"); }}
                    >
                      Change Configuration
                    </button>
                  </div>
                );
              }
              return null;
            })()}
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button className="btn btn-secondary" onClick={onGoBack}>
                Go Back & Edit
              </button>
              <button className="btn" onClick={onStartDeployment}>Try Again</button>
              {templatePath && (
                <button className="btn-template-folder" onClick={onOpenTemplateFolder}>
                  Open Template Folder
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showDetailedLogs && status?.output && (
        <div className="log-panel">
          <CopyButton text={status.output} onCopy={copyToClipboard} />
          <div className="output expanded terraform-log">
            {formatTerraformOutput(status.output)}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
