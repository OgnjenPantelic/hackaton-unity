import React from 'react';
import { useWizard } from '../../hooks/useWizard';

const RocketIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const WandIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
  const { setScreen } = useWizard();

  return (
    <div className="container">
      <div className="welcome-content">
        <h1 className="gradient" style={{ fontSize: "3em", marginBottom: "20px" }}>
          Databricks Deployer
        </h1>
        <p className="subtitle">
          Deploy Databricks workspaces with ease
        </p>

        <div className="welcome-intro">
          <p>
            Setting up Databricks workspaces with proper networking, security, and 
            Unity Catalog can be complex.{" "}
            <strong style={{ color: "#ff6b35" }}>This tool simplifies deployment</strong>{" "}
            using proven Terraform templates that follow Databricks best practices.
          </p>
          <p>
            No Terraform experience required. Follow the guided steps, configure your 
            options, and deploy a production-ready workspace. Use the built-in AI Assistant
            anytime for contextual help and end-to-end technical support during the process.
          </p>
        </div>

        <div style={{ marginTop: "50px", display: "flex", gap: "12px", alignItems: "center" }}>
          <button className="btn btn-large" onClick={() => setScreen("cloud-selection")}>
            Get Started →
          </button>
        </div>

        <div className="feature-grid">
          <div className="feature-item">
            <div className="feature-icon"><RocketIcon /></div>
            <div className="feature-title">Fast Deployment</div>
            <div className="feature-description">Deploy in minutes, not days</div>
          </div>
          <div className="feature-item">
            <div className="feature-icon"><ShieldIcon /></div>
            <div className="feature-title">Enterprise Security</div>
            <div className="feature-description">Best practices built-in</div>
          </div>
          <div className="feature-item">
            <div className="feature-icon"><WandIcon /></div>
            <div className="feature-title">No Code Required</div>
            <div className="feature-description">Simple, guided experience</div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default WelcomeScreen;
