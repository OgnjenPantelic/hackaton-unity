import { useEffect, useRef, useState } from "react";
import { useWizard } from "../hooks/useWizard";
import {
  WelcomeScreen,
  CloudSelectionScreen,
  DependenciesScreen,
  TemplateSelectionScreen,
  ConfigurationScreen,
  UnityCatalogConfigScreen,
  DeploymentScreen,
  AwsCredentialsScreen,
  AzureCredentialsScreen,
  GcpCredentialsScreen,
  DatabricksCredentialsScreen,
} from "./screens";

const ALL_STEP_GROUPS = [
  { screens: ["welcome"], label: "Start" },
  { screens: ["cloud-selection"], label: "Cloud" },
  { screens: ["dependencies"], label: "Setup" },
  { screens: ["aws-credentials", "azure-credentials", "gcp-credentials", "databricks-credentials"], label: "Auth" },
  { screens: ["template-selection"], label: "Template" },
  { screens: ["configuration"], label: "Config" },
  { screens: ["unity-catalog-config"], label: "Catalog" },
  { screens: ["deployment"], label: "Deploy" },
];

function StepIndicator({ screen }: { screen: string }) {
  const { selectedTemplate } = useWizard();
  const isSra = selectedTemplate?.id?.includes("sra") ?? false;
  const stepGroups = isSra
    ? ALL_STEP_GROUPS.filter(g => g.label !== "Catalog")
    : ALL_STEP_GROUPS;

  const currentIdx = stepGroups.findIndex(g => g.screens.includes(screen));
  if (currentIdx <= 0) return null;

  return (
    <div className="wizard-steps-global">
      {stepGroups.slice(1).map((group, i) => (
        <span key={group.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && (
            <span className={`wizard-step-connector ${i < currentIdx ? "completed" : ""}`} />
          )}
          <span
            className={`wizard-step-dot ${i + 1 === currentIdx ? "active" : ""} ${i + 1 < currentIdx ? "completed" : ""}`}
            title={group.label}
          />
        </span>
      ))}
    </div>
  );
}

export function WizardRouter() {
  const { screen } = useWizard();
  const [transitionClass, setTransitionClass] = useState("screen-transition-active");
  const prevScreen = useRef(screen);

  useEffect(() => {
    if (prevScreen.current !== screen) {
      setTransitionClass("screen-transition-enter");
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionClass("screen-transition-active");
        });
      });
      prevScreen.current = screen;
      return () => cancelAnimationFrame(raf);
    }
  }, [screen]);

  let content;
  switch (screen) {
    case "welcome":
      content = <WelcomeScreen />;
      break;
    case "cloud-selection":
      content = <CloudSelectionScreen />;
      break;
    case "dependencies":
      content = <DependenciesScreen />;
      break;
    case "aws-credentials":
      content = <AwsCredentialsScreen />;
      break;
    case "azure-credentials":
      content = <AzureCredentialsScreen />;
      break;
    case "gcp-credentials":
      content = <GcpCredentialsScreen />;
      break;
    case "databricks-credentials":
      content = <DatabricksCredentialsScreen />;
      break;
    case "template-selection":
      content = <TemplateSelectionScreen />;
      break;
    case "configuration":
      content = <ConfigurationScreen />;
      break;
    case "unity-catalog-config":
      content = <UnityCatalogConfigScreen />;
      break;
    case "deployment":
      content = <DeploymentScreen />;
      break;
    default:
      content = <WelcomeScreen />;
  }

  return (
    <>
      <StepIndicator screen={screen} />
      <div className={transitionClass}>
        {content}
      </div>
    </>
  );
}
