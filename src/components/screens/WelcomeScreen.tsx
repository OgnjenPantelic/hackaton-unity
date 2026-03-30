import React, { useState, useRef, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { useWizard } from '../../hooks/useWizard';

const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const RocketIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const WandIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 4-1 1 4 4 1-1a2.83 2.83 0 1 0-4-4z" />
    <path d="m13 6-8.5 8.5a2.12 2.12 0 1 0 3 3L16 9" />
    <path d="m2 2 4.5 4.5" />
    <path d="m19 13 2 2" />
    <path d="m13 19 2 2" />
    <path d="m2 9 3 0" />
    <path d="m9 2 0 3" />
  </svg>
);

const WelcomeScreen: React.FC = () => {
  const { setScreen, deployment } = useWizard();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; url: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then((version) => {
      setAppVersion(version);
      invoke<{ update_available: boolean; latest_version: string | null; download_url: string | null }>(
        "check_for_updates",
        { currentVersion: version }
      ).then((result) => {
        if (result.update_available && result.latest_version && result.download_url) {
          setUpdateAvailable({ version: result.latest_version, url: result.download_url });
        }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [settingsOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSettingsOpen(false);
    }
  };

  return (
    <div className="container welcome-container">
      <div className="welcome-settings" ref={menuRef} onKeyDown={handleKeyDown}>
        <button
          className="welcome-settings-btn"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-label="Settings"
          aria-expanded={settingsOpen}
          aria-haspopup="true"
        >
          <GearIcon />
        </button>
        {settingsOpen && (
          <div className="welcome-settings-menu" role="menu">
            <button
              className="welcome-settings-item"
              role="menuitem"
              onClick={() => {
                deployment.openDeploymentsFolder();
                setSettingsOpen(false);
              }}
            >
              <FolderIcon />
              Open Deployments Folder
            </button>
          </div>
        )}
      </div>
      <div className="welcome-content">
        <h1 className="gradient welcome-title">
          Databricks Deployer
        </h1>
        <p className="subtitle">
          Configure your options and deploy a production-grade workspace.
        </p>

        <ul className="welcome-features-list">
          <li><strong>Guided steps</strong> &mdash; walk through configuration at your own pace</li>
          <li><strong>Built-in validation</strong> &mdash; checks credentials, permissions, and network settings before deploy</li>
          <li><strong>AI Assistant</strong> &mdash; contextual help throughout the process</li>
        </ul>

        <div className="welcome-cta">
          <button className="btn btn-large" onClick={() => setScreen("cloud-selection")}>
            Get Started →
          </button>
        </div>

        <div className="feature-grid">
          <div className="feature-item">
            <div className="feature-icon"><RocketIcon /></div>
            <div className="feature-title">Fast Deployment</div>
          </div>
          <div className="feature-item">
            <div className="feature-icon"><ShieldIcon /></div>
            <div className="feature-title">Enterprise Security</div>
          </div>
          <div className="feature-item">
            <div className="feature-icon"><WandIcon /></div>
            <div className="feature-title">No Code Required</div>
          </div>
        </div>

        {appVersion && (
          <span className="welcome-version">
            v{appVersion}
            {updateAvailable && (
              <span
                className="welcome-update-link"
                onClick={() => invoke("open_url", { url: updateAvailable.url }).catch(() => {})}
              >
                v{updateAvailable.version} available
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

export default WelcomeScreen;
