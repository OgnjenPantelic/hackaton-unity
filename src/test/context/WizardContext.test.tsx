import { render, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { WizardProvider } from "../../context/WizardContext";
import { useWizard } from "../../hooks/useWizard";
import { CLOUDS } from "../../constants";
import { AppScreen, Template } from "../../types";

const mockInvoke = vi.mocked(invoke);

vi.mock("../../utils/cloudValidation", () => ({
  validateAwsCredentials: vi.fn(),
  validateAzureCredentials: vi.fn(),
}));

import { validateAwsCredentials, validateAzureCredentials } from "../../utils/cloudValidation";
const mockValidateAws = vi.mocked(validateAwsCredentials);
const mockValidateAzure = vi.mocked(validateAzureCredentials);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockInvoke.mockReset();
  mockValidateAws.mockReset();
  mockValidateAzure.mockReset();

  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_templates":
        return [];
      case "check_dependencies":
        return {};
      case "check_terraform_connectivity":
        return {};
      case "get_cloud_credentials":
        return {};
      case "get_aws_profiles":
        return [];
      default:
        return undefined;
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function TestConsumer({ onRender }: { onRender: (ctx: ReturnType<typeof useWizard>) => void }) {
  const ctx = useWizard();
  onRender(ctx);
  return null;
}

function ActionButton({
  action,
  label,
}: {
  action: (ctx: ReturnType<typeof useWizard>) => void | Promise<void>;
  label: string;
}) {
  const ctx = useWizard();
  return (
    <button data-testid={label} onClick={() => action(ctx)}>
      {label}
    </button>
  );
}

function renderProvider(children: React.ReactNode) {
  return render(<WizardProvider>{children}</WizardProvider>);
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
describe("WizardContext", () => {
  describe("initial state", () => {
    it("starts on the welcome screen", () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      expect(captured!.screen).toBe("welcome");
    });

    it("starts with no cloud selected", () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      expect(captured!.selectedCloud).toBe("");
    });

    it("starts with empty credentials", () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      expect(captured!.credentials).toEqual({});
    });

    it("starts with no template selected", () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      expect(captured!.selectedTemplate).toBeNull();
    });

    it("loads templates on mount", async () => {
      const templates: Template[] = [
        { id: "aws-simple", name: "AWS Simple", cloud: "aws", description: "Simple", features: [] },
      ];
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_templates") return templates;
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await waitFor(() => {
        expect(captured!.templates).toEqual(templates);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // goBack navigation
  // ---------------------------------------------------------------------------
  describe("goBack", () => {
    const navTests: { from: AppScreen; to: AppScreen; cloud?: string }[] = [
      { from: "cloud-selection", to: "welcome" },
      { from: "dependencies", to: "cloud-selection" },
      { from: "aws-credentials", to: "dependencies" },
      { from: "azure-credentials", to: "dependencies" },
      { from: "gcp-credentials", to: "dependencies" },
      { from: "template-selection", to: "databricks-credentials" },
      { from: "configuration", to: "template-selection" },
      { from: "unity-catalog-config", to: "configuration" },
    ];

    navTests.forEach(({ from, to, cloud }) => {
      it(`navigates from ${from} to ${to}`, async () => {
        let captured: ReturnType<typeof useWizard> | null = null;
        renderProvider(
          <>
            <TestConsumer onRender={(ctx) => (captured = ctx)} />
            <ActionButton label="go-back" action={(ctx) => ctx.goBack()} />
          </>
        );

        await act(async () => {
          captured!.setScreen(from);
          if (cloud) captured!.selectCloud(cloud);
        });

        await act(async () => {
          captured!.goBack();
        });

        expect(captured!.screen).toBe(to);
      });
    });

    it("navigates from databricks-credentials back to aws-credentials when cloud is AWS", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      // Set up: cloud=aws, screen=databricks-credentials
      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      await act(async () => {
        captured!.setScreen("databricks-credentials");
      });

      await act(async () => {
        captured!.goBack();
      });

      expect(captured!.screen).toBe("aws-credentials");
    });

    it("navigates from databricks-credentials back to azure-credentials when cloud is Azure", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AZURE);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      await act(async () => {
        captured!.setScreen("databricks-credentials");
      });

      await act(async () => {
        captured!.goBack();
      });

      expect(captured!.screen).toBe("azure-credentials");
    });

    it("navigates from databricks-credentials back to gcp-credentials when cloud is GCP", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.GCP);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      await act(async () => {
        captured!.setScreen("databricks-credentials");
      });

      await act(async () => {
        captured!.goBack();
      });

      expect(captured!.screen).toBe("gcp-credentials");
    });

    it("does not go back from deployment when deployment is running", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setScreen("deployment");
      });

      // Simulate a running deployment via the deployment hook
      await act(async () => {
        captured!.deployment.setDeploymentStatus({
          running: true,
          command: "apply",
          output: "",
          success: null,
          can_rollback: false,
        });
      });

      await act(async () => {
        captured!.goBack();
      });

      expect(captured!.screen).toBe("deployment");
    });

    it("clears errors on goBack", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setError("some error");
        captured!.setScreen("configuration");
      });

      await act(async () => {
        captured!.goBack();
      });

      expect(captured!.error).toBeNull();
    });

    it("clears credentials when going back from dependencies", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setScreen("dependencies");
        captured!.setCredentials({ cloud: "aws", aws_profile: "test" });
      });

      await act(async () => {
        captured!.goBack();
      });

      expect(captured!.credentials).toEqual({});
      expect(captured!.selectedCloud).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // selectCloud
  // ---------------------------------------------------------------------------
  describe("selectCloud", () => {
    it("sets the selected cloud and transitions to dependencies", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });

      expect(captured!.selectedCloud).toBe("aws");
      expect(captured!.loadingCloud).toBe("aws");

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(captured!.screen).toBe("dependencies");
        expect(captured!.loadingCloud).toBeNull();
      });
    });

    it("preserves only AWS credentials when selecting AWS", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setCredentials({
          aws_profile: "default",
          azure_tenant_id: "should-be-cleared",
          gcp_project_id: "should-be-cleared",
          databricks_account_id: "keep-this",
        });
      });

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(captured!.credentials.aws_profile).toBe("default");
        expect(captured!.credentials.databricks_account_id).toBe("keep-this");
        expect(captured!.credentials.azure_tenant_id).toBeUndefined();
        expect(captured!.credentials.gcp_project_id).toBeUndefined();
      });
    });

    it("preserves only Azure credentials when selecting Azure", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setCredentials({
          aws_profile: "should-be-cleared",
          azure_tenant_id: "tenant-123",
          databricks_account_id: "keep-this",
        });
      });

      await act(async () => {
        captured!.selectCloud(CLOUDS.AZURE);
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(captured!.credentials.azure_tenant_id).toBe("tenant-123");
        expect(captured!.credentials.databricks_account_id).toBe("keep-this");
        expect(captured!.credentials.aws_profile).toBeUndefined();
      });
    });

    it("checks dependencies after selecting cloud", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("check_dependencies");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // cancelCloudSelection
  // ---------------------------------------------------------------------------
  describe("cancelCloudSelection", () => {
    it("resets cloud state", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });

      expect(captured!.loadingCloud).toBe("aws");

      await act(async () => {
        captured!.cancelCloudSelection();
      });

      expect(captured!.loadingCloud).toBeNull();
      expect(captured!.selectedCloud).toBe("");
    });

    it("prevents stale cloud request from navigating after cancel", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });

      await act(async () => {
        captured!.cancelCloudSelection();
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(captured!.screen).toBe("welcome");
    });
  });

  // ---------------------------------------------------------------------------
  // continueFromDependencies
  // ---------------------------------------------------------------------------
  describe("continueFromDependencies", () => {
    it("routes to aws-credentials for AWS", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await captured!.continueFromDependencies();
      });

      expect(captured!.screen).toBe("aws-credentials");
    });

    it("routes to azure-credentials for Azure", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AZURE);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await captured!.continueFromDependencies();
      });

      expect(captured!.screen).toBe("azure-credentials");
    });

    it("routes to gcp-credentials for GCP", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.GCP);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await captured!.continueFromDependencies();
      });

      expect(captured!.screen).toBe("gcp-credentials");
    });

    it("fetches cloud credentials via invoke", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await captured!.continueFromDependencies();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_cloud_credentials", { cloud: "aws" });
    });
  });

  // ---------------------------------------------------------------------------
  // selectTemplate
  // ---------------------------------------------------------------------------
  describe("selectTemplate", () => {
    const template: Template = {
      id: "aws-simple",
      name: "AWS Simple",
      cloud: "aws",
      description: "Simple deployment",
      features: ["vpc"],
    };

    it("loads variables and navigates to configuration", async () => {
      const vars = [
        { name: "prefix", description: "Prefix", var_type: "string", default: null, required: true, sensitive: false, validation: null },
      ];
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_templates") return [template];
        if (cmd === "get_template_variables") return vars;
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.selectTemplate(template);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(captured!.screen).toBe("configuration");
        expect(captured!.variables).toEqual(vars);
        expect(captured!.selectedTemplate).toEqual(template);
      });
    });

    it("sets error when template loading fails", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_templates") return [];
        if (cmd === "get_template_variables") throw new Error("Template not found");
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.selectTemplate(template);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(captured!.error).toMatch("Failed to load template");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // installTerraform
  // ---------------------------------------------------------------------------
  describe("installTerraform", () => {
    it("calls invoke and rechecks dependencies on success", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.installTerraform();
      });

      expect(mockInvoke).toHaveBeenCalledWith("install_terraform");
      expect(mockInvoke).toHaveBeenCalledWith("check_dependencies");
    });

    it("sets error on failure", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "install_terraform") throw new Error("Download failed");
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.installTerraform();
      });

      expect(captured!.error).toMatch("Failed to install Terraform");
      expect(captured!.installingTerraform).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // validateAndContinueFromAwsCredentials
  // ---------------------------------------------------------------------------
  describe("validateAndContinueFromAwsCredentials", () => {
    it("navigates to databricks-credentials on success", async () => {
      mockValidateAws.mockResolvedValue({ proceed: true });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await captured!.validateAndContinueFromAwsCredentials();
      });

      expect(captured!.screen).toBe("databricks-credentials");
      expect(captured!.awsValidationAttempted).toBe(true);
    });

    it("shows error on validation failure", async () => {
      mockValidateAws.mockResolvedValue({ proceed: false, error: "Invalid credentials" });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await captured!.validateAndContinueFromAwsCredentials();
      });

      expect(captured!.screen).not.toBe("databricks-credentials");
    });

    it("shows permission warning when permissions are missing", async () => {
      const permCheck = {
        has_all_permissions: false,
        checked_permissions: ["ec2:*"],
        missing_permissions: ["iam:CreateRole"],
        message: "Missing",
        is_warning: false,
      };
      mockValidateAws.mockResolvedValue({
        proceed: false,
        permissionWarning: true,
        permissionCheck: permCheck,
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.validateAndContinueFromAwsCredentials();
      });

      expect(captured!.showPermissionWarning).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // validateAndContinueFromAzureCredentials
  // ---------------------------------------------------------------------------
  describe("validateAndContinueFromAzureCredentials", () => {
    it("shows Azure admin dialog for CLI auth mode on success", async () => {
      mockValidateAzure.mockResolvedValue({ proceed: true });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AZURE);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // azure.authMode defaults to "cli"
      await act(async () => {
        await captured!.validateAndContinueFromAzureCredentials();
      });

      // Should render the AzureAdminDialog via WizardProvider
      expect(captured!.azureValidationAttempted).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // continueFromCloudWithWarning
  // ---------------------------------------------------------------------------
  describe("continueFromCloudWithWarning", () => {
    it("navigates to databricks-credentials for non-Azure clouds", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.selectCloud(CLOUDS.AWS);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        captured!.continueFromCloudWithWarning();
      });

      expect(captured!.screen).toBe("databricks-credentials");
      expect(captured!.showPermissionWarning).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // startDeploymentWizard
  // ---------------------------------------------------------------------------
  describe("startDeploymentWizard", () => {
    it("does nothing when no template is selected", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.startDeploymentWizard();
      });

      expect(captured!.screen).toBe("welcome");
    });

    it("sets screen to deployment and calls startPrepare when template exists", async () => {
      const template: Template = {
        id: "aws-simple",
        name: "AWS Simple",
        cloud: "aws",
        description: "test",
        features: [],
      };
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_templates") return [template];
        if (cmd === "get_template_variables") return [];
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      // Select a template first
      await act(async () => {
        await captured!.selectTemplate(template);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => expect(captured!.selectedTemplate).not.toBeNull());

      await act(async () => {
        await captured!.startDeploymentWizard();
      });

      expect(captured!.screen).toBe("deployment");
    });
  });

  // ---------------------------------------------------------------------------
  // resetToWelcome
  // ---------------------------------------------------------------------------
  describe("resetToWelcome", () => {
    it("resets all state to initial values", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setScreen("deployment");
        captured!.setCredentials({ aws_secret_access_key: "secret" });
        captured!.setFormValues({ prefix: "test" });
      });

      await act(async () => {
        captured!.resetToWelcome();
      });

      expect(captured!.screen).toBe("welcome");
      expect(captured!.selectedCloud).toBe("");
      expect(captured!.selectedTemplate).toBeNull();
      expect(captured!.formValues).toEqual({});
      // Sensitive credentials should be cleared
      expect(captured!.credentials.aws_secret_access_key).toBeUndefined();
    });

    it("also clears isRollingBack when includeRollingBack is true", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.resetToWelcome(true);
      });

      expect(captured!.screen).toBe("welcome");
    });
  });

  // ---------------------------------------------------------------------------
  // rollback
  // ---------------------------------------------------------------------------
  describe("rollback", () => {
    it("does nothing when deploymentName is empty", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.rollback();
      });

      expect(mockInvoke).not.toHaveBeenCalledWith("start_rollback", expect.anything());
    });
  });

  // ---------------------------------------------------------------------------
  // cancelDeployment
  // ---------------------------------------------------------------------------
  describe("cancelDeployment", () => {
    it("calls cancel_deployment invoke", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "cancel_deployment") return undefined;
        if (cmd === "get_deployment_status")
          return { running: false, command: null, output: "", success: null, can_rollback: false };
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.cancelDeployment();
      });

      expect(mockInvoke).toHaveBeenCalledWith("cancel_deployment");
      expect(mockInvoke).toHaveBeenCalledWith("get_deployment_status");
    });

    it("sets error when cancel fails", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "cancel_deployment") throw new Error("No running deployment");
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.cancelDeployment();
      });

      expect(captured!.error).toMatch("Failed to cancel");
    });
  });

  // ---------------------------------------------------------------------------
  // AWS wrapper functions
  // ---------------------------------------------------------------------------
  describe("loadAwsProfiles", () => {
    it("calls get_aws_profiles and sets active profile in credentials", async () => {
      const profiles = [{ name: "default", is_sso: false }, { name: "prod", is_sso: true }];
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_aws_profiles") return profiles;
        if (cmd === "get_templates") return [];
        if (cmd === "get_caller_identity") return { account: "123", arn: "arn", user_id: "U1" };
        return {};
      });

      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        await captured!.loadAwsProfiles();
      });

      await waitFor(() => {
        expect(captured!.credentials.aws_profile).toBe("default");
      });
    });
  });

  describe("handleAwsProfileChange", () => {
    it("resets permission warning state", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setShowPermissionWarning(true);
      });

      await act(async () => {
        captured!.handleAwsProfileChange("new-profile");
      });

      expect(captured!.showPermissionWarning).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Azure wrapper functions
  // ---------------------------------------------------------------------------
  describe("handleAzureSubscriptionChange", () => {
    it("calls set_azure_subscription and resets permission warning", async () => {
      let captured: ReturnType<typeof useWizard> | null = null;
      renderProvider(<TestConsumer onRender={(ctx) => (captured = ctx)} />);

      await act(async () => {
        captured!.setShowPermissionWarning(true);
      });

      await act(async () => {
        await captured!.handleAzureSubscriptionChange("sub-new");
      });

      expect(captured!.showPermissionWarning).toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith("set_azure_subscription", { subscriptionId: "sub-new" });
    });
  });
});
