import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHub } from "../hooks/useGitHub";
import type { TfVarPreviewEntry, GitHubRepo } from "../types";

interface GitIntegrationCardProps {
  deploymentName: string;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TfVarsPreviewModal({
  entries,
  includeValues,
  onToggle,
  onConfirm,
  onCancel,
  loading,
}: {
  entries: TfVarPreviewEntry[];
  includeValues: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "#1e1e1e",
          border: "1px solid #444",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "560px",
          width: "90%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ margin: 0, color: "#e0e0e0", fontSize: "16px" }}>
            Review terraform.tfvars.example
          </h3>
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ color: "#999", fontSize: "13px", margin: "0 0 12px" }}>
          This file will be committed so collaborators know which variables to set.
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
            cursor: "pointer",
            color: "#e0e0e0",
            fontSize: "13px",
          }}
        >
          <input
            type="checkbox"
            checked={includeValues}
            onChange={onToggle}
            style={{ accentColor: "#3b82f6" }}
          />
          Include actual configuration values (optional)
        </label>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            border: "1px solid #333",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", color: "#999", fontWeight: "500" }}>
                  Variable
                </th>
                <th style={{ padding: "8px 12px", textAlign: "left", color: "#999", fontWeight: "500" }}>
                  Value to Commit
                </th>
                <th style={{ padding: "8px 12px", textAlign: "center", color: "#999", fontWeight: "500", width: "80px" }}>
                  Sensitive
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.name} style={{ borderBottom: "1px solid #2a2a2a" }}>
                  <td style={{ padding: "6px 12px", color: "#e0e0e0", fontFamily: "monospace" }}>
                    {entry.name}
                  </td>
                  <td
                    style={{
                      padding: "6px 12px",
                      color: entry.is_sensitive ? "#f59e0b" : includeValues ? "#4ade80" : "#888",
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      maxWidth: "250px",
                    }}
                  >
                    {entry.is_sensitive
                      ? entry.placeholder
                      : includeValues
                        ? entry.value
                        : entry.placeholder}
                  </td>
                  <td style={{ padding: "6px 12px", textAlign: "center" }}>
                    {entry.is_sensitive ? (
                      <span
                        style={{
                          background: "#7c2d12",
                          color: "#fbbf24",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                        }}
                      >
                        Yes
                      </span>
                    ) : (
                      <span
                        style={{
                          color: "#888",
                          fontSize: "11px",
                        }}
                      >
                        No
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onCancel} style={{ fontSize: "13px", padding: "8px 16px" }}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={loading} style={{ fontSize: "13px", padding: "8px 16px" }}>
            {loading ? (
              <>
                <span className="spinner" style={{ marginRight: "6px" }} />
                Initializing...
              </>
            ) : (
              "Confirm & Initialize"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceCodePanel({
  userCode,
  verificationUri,
  onCancel,
}: {
  userCode: string;
  verificationUri: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [userCode]);

  const handleOpen = useCallback(() => {
    invoke("open_url", { url: verificationUri });
  }, [verificationUri]);

  return (
    <div style={{ marginTop: "12px", padding: "12px", background: "#2a2a2a", borderRadius: "8px" }}>
      <div style={{ color: "#e0e0e0", fontSize: "13px", marginBottom: "8px" }}>
        Enter this code on GitHub to connect:
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        <code
          style={{
            fontSize: "20px",
            fontWeight: "bold",
            letterSpacing: "2px",
            color: "#60a5fa",
            background: "#1e1e1e",
            padding: "8px 16px",
            borderRadius: "6px",
            border: "1px solid #444",
          }}
        >
          {userCode}
        </code>
        <button
          className="btn btn-secondary"
          onClick={handleCopy}
          style={{ fontSize: "12px", padding: "6px 12px" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button className="btn btn-primary" onClick={handleOpen} style={{ fontSize: "13px", padding: "6px 16px" }}>
          Open GitHub
        </button>
        <span style={{ color: "#888", fontSize: "12px" }}>
          <span className="spinner" style={{ marginRight: "6px" }} />
          Waiting for authorization...
        </span>
        <button
          className="btn btn-secondary"
          onClick={onCancel}
          style={{ fontSize: "12px", padding: "4px 10px", marginLeft: "auto" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RepoCreationForm({
  defaultName,
  loading,
  onSubmit,
}: {
  defaultName: string;
  loading: boolean;
  onSubmit: (name: string, isPrivate: boolean, description: string) => void;
}) {
  const [repoName, setRepoName] = useState(defaultName);
  const [isPrivate, setIsPrivate] = useState(true);
  const [description, setDescription] = useState("Databricks workspace infrastructure");

  return (
    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          placeholder="repository-name"
          style={{
            flex: 1,
            padding: "8px 12px",
            background: "#2a2a2a",
            border: "1px solid #444",
            borderRadius: "6px",
            color: "#e0e0e0",
            fontSize: "13px",
            outline: "none",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "#e0e0e0",
            fontSize: "13px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            style={{ accentColor: "#3b82f6" }}
          />
          Private
        </label>
      </div>
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Repository description (optional)"
        style={{
          padding: "8px 12px",
          background: "#2a2a2a",
          border: "1px solid #444",
          borderRadius: "6px",
          color: "#e0e0e0",
          fontSize: "13px",
          outline: "none",
        }}
      />
      <button
        className="btn btn-primary"
        onClick={() => onSubmit(repoName, isPrivate, description)}
        disabled={loading || !repoName.trim()}
        style={{ fontSize: "13px", padding: "8px 16px", alignSelf: "flex-start" }}
      >
        {loading ? (
          <>
            <span className="spinner" style={{ marginRight: "6px" }} />
            Creating...
          </>
        ) : (
          "Create Repository & Push"
        )}
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function GitIntegrationCard({ deploymentName }: GitIntegrationCardProps) {
  const {
    gitStatus,
    gitStep,
    error,
    remoteUrl,
    loading,
    previewEntries,
    authStatus,
    deviceCode,
    setRemoteUrl,
    setError,
    refreshStatus,
    loadPreview,
    initRepo,
    checkRemote,
    pushToRemote,
    checkAuth,
    startDeviceAuth,
    cancelDeviceAuth,
    logout,
    createRepo,
  } = useGitHub();

  const [showPreview, setShowPreview] = useState(false);
  const [includeValues, setIncludeValues] = useState(true);
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [createdRepo, setCreatedRepo] = useState<GitHubRepo | null>(null);
  const [activeTab, setActiveTab] = useState<"create" | "existing">("create");

  useEffect(() => {
    if (deploymentName) {
      refreshStatus(deploymentName);
      checkAuth();
    }
  }, [deploymentName, refreshStatus, checkAuth]);

  const handleInitClick = useCallback(async () => {
    const ok = await loadPreview(deploymentName);
    if (ok) setShowPreview(true);
  }, [deploymentName, loadPreview]);

  const handleConfirmInit = useCallback(async () => {
    const ok = await initRepo(deploymentName, includeValues);
    if (ok) setShowPreview(false);
  }, [deploymentName, includeValues, initRepo]);

  const handlePush = useCallback(async () => {
    if (!remoteUrl.trim()) return;
    setError(null);
    const accessCheck = await checkRemote(deploymentName, remoteUrl.trim());
    if (!accessCheck.success) return;
    const success = await pushToRemote(deploymentName, remoteUrl.trim());
    if (success) setPushSuccess(true);
  }, [deploymentName, remoteUrl, checkRemote, pushToRemote, setError]);

  const handleCreateRepo = useCallback(
    async (name: string, isPrivate: boolean, description: string) => {
      const repo = await createRepo(deploymentName, name, isPrivate, description);
      if (repo) {
        setCreatedRepo(repo);
        setPushSuccess(true);
      }
    },
    [deploymentName, createRepo],
  );

  const repoUrl = createdRepo?.html_url || gitStatus?.remote_url || "";
  const isGitHubUrl = repoUrl.includes("github.com");
  const browseUrl = isGitHubUrl
    ? repoUrl
        .replace(/^git@github\.com:/, "https://github.com/")
        .replace(/\.git$/, "")
    : "";

  const repoSlug = deploymentName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  // ─── Not initialized ─────────────────────────────────────────────

  if (!gitStatus?.initialized) {
    return (
      <>
        <div
          style={{
            background: "#1e1e1e",
            border: "1px solid #333",
            borderRadius: "8px",
            padding: "16px 20px",
            marginBottom: "20px",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: error ? "12px" : "0" }}>
            <span style={{ fontSize: "20px" }}>📦</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#e0e0e0", fontSize: "14px", fontWeight: "500" }}>Version Control</div>
              <div style={{ color: "#888", fontSize: "13px" }}>
                Version control your infrastructure with Git and GitHub
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleInitClick}
              disabled={loading || gitStep === "previewing"}
              style={{ fontSize: "13px", padding: "6px 16px" }}
            >
              {gitStep === "previewing" ? (
                <>
                  <span className="spinner" style={{ marginRight: "6px" }} />
                  Loading...
                </>
              ) : (
                "Initialize Git"
              )}
            </button>
          </div>
          {error && <div style={{ color: "#ef4444", fontSize: "12px", marginTop: "8px" }}>{error}</div>}
        </div>

        {showPreview && previewEntries && (
          <TfVarsPreviewModal
            entries={previewEntries}
            includeValues={includeValues}
            onToggle={() => setIncludeValues((v) => !v)}
            onConfirm={handleConfirmInit}
            onCancel={() => setShowPreview(false)}
            loading={gitStep === "initializing"}
          />
        )}
      </>
    );
  }

  // ─── Initialized ──────────────────────────────────────────────────

  const isAuthenticated = authStatus?.authenticated === true;
  const hasRemote = gitStatus.has_remote || pushSuccess;

  return (
    <div
      style={{
        background: "#1e1e1e",
        border: "1px solid #333",
        borderRadius: "8px",
        padding: "16px 20px",
        marginBottom: "20px",
        width: "100%",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "20px" }}>✓</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#4ade80", fontSize: "14px", fontWeight: "500" }}>
            Git Repository Initialized
          </div>
          <div style={{ color: "#888", fontSize: "13px" }}>
            {hasRemote && repoUrl
              ? repoUrl
              : `${gitStatus.commit_count} commit${gitStatus.commit_count !== 1 ? "s" : ""} on ${gitStatus.branch || "main"}`}
          </div>
        </div>

        {browseUrl && hasRemote ? (
          <a
            href={browseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "13px", padding: "6px 16px", textDecoration: "none" }}
            onClick={(e) => {
              e.preventDefault();
              invoke("open_url", { url: browseUrl });
            }}
          >
            View on GitHub
          </a>
        ) : null}
      </div>

      {/* GitHub auth + push section (only if no remote yet) */}
      {!hasRemote && (
        <div style={{ marginTop: "12px" }}>
          {/* GitHub auth status bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
              padding: "8px 12px",
              background: "#2a2a2a",
              borderRadius: "6px",
            }}
          >
            {isAuthenticated ? (
              <>
                {authStatus.avatar_url && (
                  <img
                    src={authStatus.avatar_url}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: "50%" }}
                  />
                )}
                <span style={{ color: "#e0e0e0", fontSize: "13px", flex: 1 }}>
                  Connected as <strong>{authStatus.username}</strong>
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={logout}
                  style={{ fontSize: "11px", padding: "3px 10px" }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <span style={{ color: "#888", fontSize: "13px", flex: 1 }}>
                  Connect to GitHub to create a repository
                </span>
                <button
                  className="btn btn-primary"
                  onClick={startDeviceAuth}
                  disabled={gitStep === "authenticating"}
                  style={{ fontSize: "12px", padding: "4px 14px" }}
                >
                  {gitStep === "authenticating" && !deviceCode
                    ? "Connecting..."
                    : "Connect to GitHub"}
                </button>
              </>
            )}
          </div>

          {/* Device code panel */}
          {deviceCode && (
            <DeviceCodePanel
              userCode={deviceCode.user_code}
              verificationUri={deviceCode.verification_uri}
              onCancel={cancelDeviceAuth}
            />
          )}

          {/* Repo actions (tabs: Create New / Push to Existing) */}
          {isAuthenticated && !deviceCode && (
            <>
              <div style={{ display: "flex", gap: "0", marginBottom: "4px" }}>
                {(["create", "existing"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "6px 16px",
                      fontSize: "12px",
                      background: activeTab === tab ? "#333" : "transparent",
                      color: activeTab === tab ? "#e0e0e0" : "#888",
                      border: "1px solid #444",
                      borderBottom: activeTab === tab ? "1px solid #333" : "1px solid #444",
                      borderRadius: tab === "create" ? "6px 0 0 0" : "0 6px 0 0",
                      cursor: "pointer",
                    }}
                  >
                    {tab === "create" ? "Create New Repository" : "Push to Existing Empty Repo"}
                  </button>
                ))}
              </div>

              {activeTab === "create" ? (
                <RepoCreationForm
                  defaultName={repoSlug}
                  loading={gitStep === "creating-repo"}
                  onSubmit={handleCreateRepo}
                />
              ) : (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="git@github.com:user/repo.git"
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        background: "#2a2a2a",
                        border: "1px solid #444",
                        borderRadius: "6px",
                        color: "#e0e0e0",
                        fontSize: "13px",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handlePush();
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handlePush}
                      disabled={loading || !remoteUrl.trim()}
                      style={{ fontSize: "13px", padding: "6px 16px" }}
                    >
                      {gitStep === "checking-remote"
                        ? "Checking..."
                        : gitStep === "pushing"
                          ? "Pushing..."
                          : "Push"}
                    </button>
                  </div>
                  <div style={{ color: "#666", fontSize: "11px", marginTop: "6px" }}>
                    Create an empty repository on GitHub first, then paste the URL here.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Fallback push option when not authenticated */}
          {!isAuthenticated && !deviceCode && (
            <>
              {showRemoteInput ? (
                <div style={{ marginTop: "4px" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="git@github.com:user/repo.git"
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        background: "#2a2a2a",
                        border: "1px solid #444",
                        borderRadius: "6px",
                        color: "#e0e0e0",
                        fontSize: "13px",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handlePush();
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handlePush}
                      disabled={loading || !remoteUrl.trim()}
                      style={{ fontSize: "13px", padding: "6px 16px" }}
                    >
                      {gitStep === "checking-remote"
                        ? "Checking..."
                        : gitStep === "pushing"
                          ? "Pushing..."
                          : "Push"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowRemoteInput(false);
                        setError(null);
                      }}
                      style={{ fontSize: "13px", padding: "6px 12px" }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div style={{ color: "#666", fontSize: "11px", marginTop: "6px" }}>
                    Create an empty repository on GitHub first, then paste the URL here.
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowRemoteInput(true)}
                    style={{ fontSize: "12px", padding: "4px 14px", color: "#888" }}
                  >
                    Or push to an existing repository without connecting
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {error && <div style={{ color: "#ef4444", fontSize: "12px", marginTop: "8px" }}>{error}</div>}
    </div>
  );
}
