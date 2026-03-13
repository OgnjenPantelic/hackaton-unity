import { render, screen } from "@testing-library/react";
import { WizardRouter } from "../../components/WizardRouter";
import { createMockWizardContext, WizardWrapper } from "../helpers/wizardContext";
import { AppScreen } from "../../types";

vi.mock("../../components/screens", () => ({
  WelcomeScreen: () => <div data-testid="screen-welcome">Welcome</div>,
  CloudSelectionScreen: () => <div data-testid="screen-cloud-selection">CloudSelection</div>,
  DependenciesScreen: () => <div data-testid="screen-dependencies">Dependencies</div>,
  TemplateSelectionScreen: () => <div data-testid="screen-template-selection">TemplateSelection</div>,
  ConfigurationScreen: () => <div data-testid="screen-configuration">Configuration</div>,
  UnityCatalogConfigScreen: () => <div data-testid="screen-unity-catalog-config">UnityCatalog</div>,
  DeploymentScreen: () => <div data-testid="screen-deployment">Deployment</div>,
  AwsCredentialsScreen: () => <div data-testid="screen-aws-credentials">AwsCredentials</div>,
  AzureCredentialsScreen: () => <div data-testid="screen-azure-credentials">AzureCredentials</div>,
  GcpCredentialsScreen: () => <div data-testid="screen-gcp-credentials">GcpCredentials</div>,
  DatabricksCredentialsScreen: () => <div data-testid="screen-databricks-credentials">DatabricksCredentials</div>,
}));

function renderRouter(screenName: AppScreen, contextOverrides = {}) {
  const ctx = createMockWizardContext({ screen: screenName, ...contextOverrides });
  return render(
    <WizardWrapper value={ctx}>
      <WizardRouter />
    </WizardWrapper>
  );
}

describe("WizardRouter", () => {
  // ---------------------------------------------------------------------------
  // Screen routing
  // ---------------------------------------------------------------------------
  describe("screen routing", () => {
    const screenCases: { name: AppScreen; testId: string }[] = [
      { name: "welcome", testId: "screen-welcome" },
      { name: "cloud-selection", testId: "screen-cloud-selection" },
      { name: "dependencies", testId: "screen-dependencies" },
      { name: "aws-credentials", testId: "screen-aws-credentials" },
      { name: "azure-credentials", testId: "screen-azure-credentials" },
      { name: "gcp-credentials", testId: "screen-gcp-credentials" },
      { name: "databricks-credentials", testId: "screen-databricks-credentials" },
      { name: "template-selection", testId: "screen-template-selection" },
      { name: "configuration", testId: "screen-configuration" },
      { name: "unity-catalog-config", testId: "screen-unity-catalog-config" },
      { name: "deployment", testId: "screen-deployment" },
    ];

    screenCases.forEach(({ name, testId }) => {
      it(`renders the correct component for screen "${name}"`, () => {
        renderRouter(name);
        expect(screen.getByTestId(testId)).toBeInTheDocument();
      });
    });

    it("falls back to WelcomeScreen for an unknown screen value", () => {
      renderRouter("unknown-screen" as AppScreen);
      expect(screen.getByTestId("screen-welcome")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Step indicator
  // ---------------------------------------------------------------------------
  describe("step indicator", () => {
    it("is hidden on the welcome screen", () => {
      const { container } = renderRouter("welcome");
      expect(container.querySelector(".wizard-steps-global")).toBeNull();
    });

    it("is visible on the cloud-selection screen", () => {
      const { container } = renderRouter("cloud-selection");
      expect(container.querySelector(".wizard-steps-global")).toBeInTheDocument();
    });

    it("renders step dots for each wizard step", () => {
      const { container } = renderRouter("configuration");
      const dots = container.querySelectorAll(".wizard-step-dot");
      expect(dots.length).toBeGreaterThanOrEqual(6);
    });

    it("marks the current step as active", () => {
      const { container } = renderRouter("dependencies");
      const activeDots = container.querySelectorAll(".wizard-step-dot.active");
      expect(activeDots.length).toBe(1);
    });

    it("marks earlier steps as completed", () => {
      const { container } = renderRouter("template-selection");
      const completedDots = container.querySelectorAll(".wizard-step-dot.completed");
      expect(completedDots.length).toBeGreaterThan(0);
    });

    it("skips Catalog step when template is gcp-sra", () => {
      const template = { id: "gcp-sra", name: "GCP SRA", cloud: "gcp", description: "", features: [] };
      const { container } = renderRouter("configuration", { selectedTemplate: template });
      const dots = container.querySelectorAll(".wizard-step-dot");
      // Without catalog step, there should be one fewer dot
      const { container: containerWithCatalog } = renderRouter("configuration");
      const dotsWithCatalog = containerWithCatalog.querySelectorAll(".wizard-step-dot");
      expect(dots.length).toBe(dotsWithCatalog.length - 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Transition class
  // ---------------------------------------------------------------------------
  describe("transition", () => {
    it("renders content in a transition wrapper", () => {
      const { container } = renderRouter("welcome");
      const wrapper = container.querySelector(".screen-transition-active");
      expect(wrapper).toBeInTheDocument();
    });
  });
});
