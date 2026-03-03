import React from 'react';
import { CLOUDS, CLOUD_DISPLAY_NAMES } from '../../constants';
import { useWizard } from '../../hooks/useWizard';

const CloudSelectionScreen: React.FC = () => {
  const { loadingCloud, selectCloud, selectedCloud, goBack } = useWizard();

  const clouds = [
    { id: CLOUDS.AZURE, name: "Azure", desc: "Deploy on Microsoft Azure with VNet injection and Unity Catalog support" },
    { id: CLOUDS.AWS, name: "AWS", desc: "Deploy on Amazon Web Services with customer-managed VPC and Unity Catalog support" },
    { id: CLOUDS.GCP, name: "GCP", desc: "Deploy on Google Cloud Platform with customer-managed VPC and Unity Catalog support" },
  ];

  return (
    <div className="container">
      <button className="back-btn" onClick={goBack} disabled={!!loadingCloud}>
        ← Back
      </button>
      <h1>Select Cloud Provider</h1>
      <p className="subtitle">
        Select the cloud platform on which you would like to deploy your Databricks workspace.
      </p>

      {loadingCloud && (
        <div className="loading-overlay">
          <div className="loading-content">
            <span className="spinner large" />
            <div>Checking {CLOUD_DISPLAY_NAMES[loadingCloud] || loadingCloud} dependencies...</div>
            <button
              className="btn btn-secondary"
              onClick={goBack}
              style={{ marginTop: "16px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="cloud-selection">
        {clouds.map(({ id, name, desc }) => (
          <button
            key={id}
            className={`cloud-card ${id} ${loadingCloud ? "disabled" : ""} ${selectedCloud === id ? "selected" : ""}`}
            onClick={() => !loadingCloud && selectCloud(id)}
            disabled={!!loadingCloud}
            type="button"
          >
            <div className="cloud-name">{name}</div>
            <div className="cloud-description">{desc}</div>
            {selectedCloud === id && (
              <div style={{ position: "absolute", top: 12, right: 12, color: "var(--success)", fontSize: "14px" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CloudSelectionScreen;
