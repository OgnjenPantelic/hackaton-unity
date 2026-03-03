import { createContext, useState, useEffect, useCallback, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DependencyStatus,
  Template,
  TerraformVariable,
  DeploymentStatus,
  CloudCredentials,
  AppScreen,
  UnityCatalogConfig,
  UCPermissionCheck,
} from "../types";
import { CLOUDS, POLLING, UI } from "../constants";
import { initializeFormDefaults } from "../utils/variables";
import {
  useAwsAuth,
  useAzureAuth,
  useGcpAuth,
  useDeployment,
  useUnityCatalog,
} from "../hooks";
import type {
  UseAwsAuthReturn,
  UseAzureAuthReturn,
  UseGcpAuthReturn,
  UseDeploymentReturn,
} from "../hooks";
import { validateAwsCredentials, validateAzureCredentials } from "../utils/cloudValidation";
import { AzureAdminDialog } from "../components/ui/AzureAdminDialog";

// ---------------------------------------------------------------------------
// Context value interface
// ---------------------------------------------------------------------------
export interface WizardContextValue {
  // Navigation
  screen: AppScreen;
  setScreen: (screen: AppScreen) => void;
  goBack: () => void;

  // Cloud selection
  selectedCloud: string;
  loadingCloud: string | null;
  selectCloud: (cloud: string) => void;

  // Dependencies
  dependencies: Record<string, DependencyStatus>;
  installingTerraform: boolean;
  installTerraform: () => Promise<void>;
  recheckDependencies: () => Promise<void>;
  continueFromDependencies: () => Promise<void>;

  // Templates
  templates: Template[];
  selectedTemplate: Template | null;
  selectTemplate: (template: Template) => Promise<void>;

  // Credentials
  credentials: CloudCredentials;
  setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>;

  // Auth hooks (exposed as full return objects)
  aws: UseAwsAuthReturn;
  azure: UseAzureAuthReturn;
  gcp: UseGcpAuthReturn;

  // AWS wrapper functions
  loadAwsProfiles: () => Promise<void>;
  handleAwsProfileChange: (profile: string) => void;
  handleAwsSsoLogin: () => Promise<void>;

  // Azure wrapper functions
  checkAzureAccount: () => Promise<void>;
  handleAzureLogin: () => Promise<void>;
  handleAzureSubscriptionChange: (subscriptionId: string) => Promise<void>;

  // Permission warnings
  checkingPermissions: boolean;
  showPermissionWarning: boolean;
  setShowPermissionWarning: (show: boolean) => void;
  permissionWarningAcknowledged: boolean;
  setPermissionWarningAcknowledged: (acknowledged: boolean) => void;
  awsValidationAttempted: boolean;
  azureValidationAttempted: boolean;
  validateAndContinueFromAwsCredentials: () => Promise<void>;
  validateAndContinueFromAzureCredentials: () => Promise<void>;
  continueFromCloudWithWarning: () => void;

  // Deployment
  deployment: UseDeploymentReturn;
  startDeploymentWizard: () => Promise<void>;
  confirmAndDeploy: () => Promise<void>;
  cancelDeployment: () => Promise<void>;
  rollback: () => Promise<void>;
  resetToWelcome: (includeRollingBack?: boolean) => void;
  copyToClipboard: (text: string) => Promise<void>;

  // Unity Catalog
  ucConfig: UnityCatalogConfig;
  setUcConfig: React.Dispatch<React.SetStateAction<UnityCatalogConfig>>;
  ucPermissionCheck: UCPermissionCheck | null;
  ucPermissionAcknowledged: boolean;
  setUcPermissionAcknowledged: (acknowledged: boolean) => void;
  ucCheckLoading: boolean;
  ucCheckError: string | null;
  refreshUCPermissions: () => void;
  generateStorageName: () => string;

  // Form state
  variables: TerraformVariable[];
  formValues: Record<string, any>;
  setFormValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  tagPairs: { key: string; value: string }[];
  setTagPairs: React.Dispatch<React.SetStateAction<{ key: string; value: string }[]>>;
  showAdvanced: boolean;
  setShowAdvanced: (show: boolean) => void;
  formSubmitAttempted: boolean;
  setFormSubmitAttempted: (attempted: boolean) => void;

  // Shared UI
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
}

// ---------------------------------------------------------------------------
// Context (no default value — guarded by useWizard hook)
// ---------------------------------------------------------------------------
export const WizardContext = createContext<WizardContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function WizardProvider({ children }: { children: ReactNode }) {
  // -- State ----------------------------------------------------------------
  const [screen, setScreen] = useState<AppScreen>("welcome");
  const [dependencies, setDependencies] = useState<Record<string, DependencyStatus>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCloud, setSelectedCloud] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variables, setVariables] = useState<TerraformVariable[]>([]);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [credentials, setCredentials] = useState<CloudCredentials>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingTerraform, setInstallingTerraform] = useState(false);
  const [loadingCloud, setLoadingCloud] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);
  const [tagPairs, setTagPairs] = useState<{ key: string; value: string }[]>([]);

  const [showPermissionWarning, setShowPermissionWarning] = useState(false);
  const [permissionWarningAcknowledged, setPermissionWarningAcknowledged] = useState(false);
  const [awsValidationAttempted, setAwsValidationAttempted] = useState(false);
  const [azureValidationAttempted, setAzureValidationAttempted] = useState(false);
  const [showAzureAdminDialog, setShowAzureAdminDialog] = useState(false);

  // -- Hooks ----------------------------------------------------------------
  const {
    ucConfig, setUcConfig,
    ucPermissionCheck,
    ucPermissionAcknowledged, setUcPermissionAcknowledged,
    ucCheckLoading, ucCheckError,
    refreshUCPermissions, generateStorageName, resetUcState,
  } = useUnityCatalog(screen, selectedTemplate, formValues, credentials, selectedCloud);

  const aws = useAwsAuth();
  const azure = useAzureAuth();
  const gcp = useGcpAuth();
  const deployment = useDeployment();

  const checkingPermissions =
    aws.checkingPermissions || azure.checkingPermissions || gcp.checkingPermissions;

  // -- Effects --------------------------------------------------------------
  const loadTemplates = async () => {
    try {
      const tmpl = await invoke<Template[]>("get_templates");
      setTemplates(tmpl);
    } catch {
      // Templates load failed — UI will show empty state
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    return () => {
      aws.cleanup();
      deployment.cleanup();
    };
  }, [aws.cleanup, deployment.cleanup]);

  // -- Helpers & handlers ---------------------------------------------------
  const checkDependencies = async () => {
    try {
      const deps = await invoke<Record<string, DependencyStatus>>("check_dependencies");
      setDependencies(deps);
    } catch {
      // Dependencies check failed — UI will show default state
    }
  };

  const loadAzureResourceGroups = async (_forceRefresh = false) => {
    const subscriptionId = credentials.azure_subscription_id || "";
    if (subscriptionId) {
      await azure.loadResourceGroups(subscriptionId, credentials);
    }
  };

  const loadAzureVnets = async () => {
    await azure.loadVnets(credentials);
  };

  const installTerraform = async () => {
    setInstallingTerraform(true);
    setError(null);
    try {
      await invoke("install_terraform");
      await checkDependencies();
    } catch (e: unknown) {
      setError(`Failed to install Terraform: ${String(e)}`);
    } finally {
      setInstallingTerraform(false);
    }
  };

  const selectCloud = (cloud: string) => {
    setLoadingCloud(cloud);
    setSelectedCloud(cloud);
    
    // Clear all cloud-specific credentials when switching clouds
    setCredentials(prev => {
      const base = {
        databricks_account_id: prev.databricks_account_id, // Keep account ID
      };
      
      // Only keep credentials relevant to the selected cloud
      switch (cloud) {
        case CLOUDS.AWS:
          return {
            ...base,
            aws_profile: prev.aws_profile,
            aws_access_key_id: prev.aws_access_key_id,
            aws_secret_access_key: prev.aws_secret_access_key,
            aws_session_token: prev.aws_session_token,
            aws_region: prev.aws_region,
          };
        case CLOUDS.AZURE:
          return {
            ...base,
            azure_tenant_id: prev.azure_tenant_id,
            azure_subscription_id: prev.azure_subscription_id,
            azure_client_id: prev.azure_client_id,
            azure_client_secret: prev.azure_client_secret,
            azure_databricks_use_identity: prev.azure_databricks_use_identity,
            azure_account_email: prev.azure_account_email,
          };
        case CLOUDS.GCP:
          return {
            ...base,
            gcp_project_id: prev.gcp_project_id,
            gcp_credentials_json: prev.gcp_credentials_json,
            gcp_use_adc: prev.gcp_use_adc,
            gcp_oauth_token: prev.gcp_oauth_token,
            gcp_service_account_email: prev.gcp_service_account_email,
          };
        default:
          return base;
      }
    });
    
    setTimeout(async () => {
      await Promise.all([
        checkDependencies(),
        new Promise((resolve) => setTimeout(resolve, POLLING.MIN_LOADING_TIME)),
      ]);
      setLoadingCloud(null);
      setScreen("dependencies");
    }, UI.REACT_PAINT_DELAY);
  };

  const selectTemplate = async (template: Template) => {
    const isSameTemplate = selectedTemplate?.id === template.id;
    const hasExistingValues = Object.keys(formValues).length > 0;

    setSelectedTemplate(template);
    setLoading(true);
    setFormSubmitAttempted(false);
    try {
      const vars = await invoke<TerraformVariable[]>("get_template_variables", {
        templateId: template.id,
      });
      setVariables(vars);

      if (!isSameTemplate || !hasExistingValues) {
        const defaults = initializeFormDefaults(vars, {
          azureUser: azure.account?.user,
          gcpAccount: gcp.validation?.account,
          awsAccountId: aws.identity?.account,
        });
        setFormValues(defaults);
        setTagPairs([]);
      }

      if (selectedCloud === CLOUDS.AZURE) {
        loadAzureResourceGroups();
        loadAzureVnets();
      }
    } catch (e: unknown) {
      setError(`Failed to load template: ${String(e)}`);
    } finally {
      setLoading(false);
    }
    setScreen("configuration");
  };

  const clearSensitiveCredentials = useCallback(() => {
    setCredentials((prev) => ({
      ...prev,
      databricks_client_secret: undefined,
      aws_secret_access_key: undefined,
      aws_session_token: undefined,
      azure_client_secret: undefined,
    }));
  }, []);

  const startDeploymentWizard = useCallback(async () => {
    if (!selectedTemplate) return;
    setScreen("deployment");
    try {
      await deployment.startPrepare(selectedTemplate, credentials, formValues, ucConfig);
    } catch (e: unknown) {
      setError(`Failed to start deployment: ${String(e)}`);
    }
  }, [selectedTemplate, credentials, formValues, ucConfig, deployment.startPrepare]);

  const confirmAndDeploy = useCallback(async () => {
    if (!selectedTemplate || deployment.deploymentStep !== "review") return;
    try {
      await deployment.startApply();
    } catch (e: unknown) {
      setError(`Failed to apply deployment: ${String(e)}`);
    }
  }, [selectedTemplate, deployment.deploymentStep, deployment.startApply]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Copy failed
    }
  }, []);

  const resetToWelcome = useCallback(
    (includeRollingBack = false) => {
      setScreen("welcome");
      setSelectedCloud("");
      setSelectedTemplate(null);
      deployment.setDeploymentStep("ready");
      deployment.setDeploymentName(""); // Clear for fresh deployment
      deployment.setTemplatePath(""); // Clear path as well
      setFormValues({});
      resetUcState();
      clearSensitiveCredentials();
      if (includeRollingBack) {
        deployment.setIsRollingBack(false);
      }
    },
    [clearSensitiveCredentials, resetUcState, deployment.setDeploymentStep, deployment.setDeploymentName, deployment.setTemplatePath, deployment.setIsRollingBack]
  );

  const continueFromCloudWithWarning = useCallback(() => {
    setShowPermissionWarning(false);
    setPermissionWarningAcknowledged(false);
    setScreen("databricks-credentials");
  }, []);

  // -- AWS wrappers ---------------------------------------------------------
  const loadAwsProfiles = async () => {
    const profiles = await aws.loadProfiles();
    if (profiles.length > 0 && !credentials.aws_profile) {
      const defaultProfile = profiles.find((p) => p.name === "default") || profiles[0];
      setCredentials((prev) => ({ ...prev, aws_profile: defaultProfile.name }));
      aws.checkIdentity(defaultProfile.name);
    }
  };

  const handleAwsProfileChange = (profile: string) => {
    aws.handleProfileChange(profile, setCredentials);
    // Reset permission warning state so user can re-validate with new profile
    setShowPermissionWarning(false);
    setPermissionWarningAcknowledged(false);
    aws.setPermissionCheck(null);
  };

  const handleAwsSsoLogin = async () => {
    const profile = credentials.aws_profile || "default";
    await aws.handleSsoLogin(profile);
  };

  // -- Azure wrappers -------------------------------------------------------
  const checkAzureAccount = async () => {
    const account = await azure.loadAccount();
    if (account) {
      setCredentials((prev) => ({
        ...prev,
        azure_tenant_id: account.tenant_id,
        azure_subscription_id: account.subscription_id,
        azure_account_email: account.user,
      }));
      await azure.loadSubscriptions();
    }
  };

  const handleAzureLogin = async () => {
    await azure.handleAzureLogin();
    const account = await azure.loadAccount();
    if (account) {
      setCredentials((prev) => ({
        ...prev,
        azure_tenant_id: account.tenant_id,
        azure_subscription_id: account.subscription_id,
        azure_account_email: account.user,
      }));
      await azure.loadSubscriptions();
    }
  };

  const handleAzureSubscriptionChange = async (subscriptionId: string) => {
    azure.handleSubscriptionChange(subscriptionId, azure.subscriptions, setCredentials);
    // Reset permission warning state so user can re-validate with new subscription
    setShowPermissionWarning(false);
    setPermissionWarningAcknowledged(false);
    azure.setPermissionCheck(null);
    try {
      await invoke("set_azure_subscription", { subscriptionId });
    } catch {
      // Subscription switch failed — user can retry
    }
  };

  // -- Deployment actions ---------------------------------------------------
  const cancelDeployment = async () => {
    try {
      await invoke("cancel_deployment");
      const status = await invoke<DeploymentStatus>("get_deployment_status");
      deployment.setDeploymentStatus(status);
    } catch (e: unknown) {
      setError(`Failed to cancel: ${String(e)}`);
    }
  };

  const rollback = async () => {
    if (!deployment.deploymentName) return;
    setError(null);
    deployment.setDeploymentStep("deploying");
    await deployment.startRollback(deployment.deploymentName, credentials, {
      keepRollingBackOnSuccess: true,
    });
  };

  // -- Navigation -----------------------------------------------------------
  const goBack = () => {
    setError(null);
    aws.setError(null);
    azure.setError(null);
    switch (screen) {
      case "cloud-selection":
        setScreen("welcome");
        clearSensitiveCredentials();
        break;
      case "dependencies":
        setScreen("cloud-selection");
        setSelectedCloud("");
        setCredentials({});
        break;
      case "aws-credentials":
        setScreen("dependencies");
        break;
      case "azure-credentials":
        setScreen("dependencies");
        break;
      case "gcp-credentials":
        setScreen("dependencies");
        break;
      case "databricks-credentials":
        if (selectedCloud === CLOUDS.AWS) {
          setScreen("aws-credentials");
        } else if (selectedCloud === CLOUDS.AZURE) {
          setScreen("azure-credentials");
        } else if (selectedCloud === CLOUDS.GCP) {
          setScreen("gcp-credentials");
        } else {
          setScreen("dependencies");
        }
        break;
      case "template-selection":
        setScreen("databricks-credentials");
        break;
      case "configuration":
        setScreen("template-selection");
        break;
      case "unity-catalog-config":
        setScreen("configuration");
        resetUcState();
        break;
      case "deployment":
        if (!deployment.deploymentStatus?.running) {
          setScreen("unity-catalog-config");
          deployment.setDeploymentStep("ready");
        }
        break;
    }
  };

  const continueFromDependencies = async () => {
    try {
      const creds = await invoke<CloudCredentials>("get_cloud_credentials", {
        cloud: selectedCloud,
      });
      setCredentials(creds);
    } catch {
      // Credentials fetch failed — user will enter manually
    }

    if (selectedCloud === CLOUDS.AWS) {
      loadAwsProfiles();
      setScreen("aws-credentials");
    } else if (selectedCloud === CLOUDS.AZURE) {
      checkAzureAccount();
      setScreen("azure-credentials");
    } else if (selectedCloud === CLOUDS.GCP) {
      setScreen("gcp-credentials");
    } else {
      setScreen("databricks-credentials");
    }
  };

  // -- Cloud credential validation ------------------------------------------
  const validateAndContinueFromAwsCredentials = async () => {
    setAwsValidationAttempted(true);
    aws.setError(null);
    aws.setCheckingPermissions(true);

    const result = await validateAwsCredentials({
      authMode: aws.authMode,
      identity: aws.identity,
      credentials,
    });

    aws.setCheckingPermissions(false);

    if (result.error) {
      aws.setError(result.error);
      return;
    }

    if (result.permissionWarning && result.permissionCheck) {
      aws.setPermissionCheck(result.permissionCheck);
      setShowPermissionWarning(true);
      setPermissionWarningAcknowledged(false);
      return;
    }

    if (result.permissionCheck) {
      aws.setPermissionCheck(result.permissionCheck);
    }

    setScreen("databricks-credentials");
  };

  const validateAndContinueFromAzureCredentials = async () => {
    setAzureValidationAttempted(true);
    azure.setError(null);
    azure.setCheckingPermissions(true);

    const result = await validateAzureCredentials({
      authMode: azure.authMode,
      account: azure.account,
      credentials,
    });

    azure.setCheckingPermissions(false);

    if (result.error) {
      azure.setError(result.error);
      return;
    }

    if (result.permissionWarning && result.permissionCheck) {
      azure.setPermissionCheck(result.permissionCheck);
      setShowPermissionWarning(true);
      setPermissionWarningAcknowledged(false);
      return;
    }

    if (result.permissionCheck) {
      azure.setPermissionCheck(result.permissionCheck);
    }

    // Only show Azure Admin dialog in CLI mode (user has already authenticated via Azure CLI)
    if (azure.authMode === "cli" && credentials.azure_account_email) {
      setShowAzureAdminDialog(true);
    } else {
      // Service principal mode or no email → skip dialog
      setCredentials((prev) => ({ ...prev, azure_databricks_use_identity: false }));
      setScreen("databricks-credentials");
    }
  };

  const handleAzureAdminDialogYes = () => {
    setShowAzureAdminDialog(false);
    setCredentials((prev) => ({ ...prev, azure_databricks_use_identity: true }));
    setScreen("databricks-credentials");
  };

  const handleAzureAdminDialogNo = () => {
    setShowAzureAdminDialog(false);
    setCredentials((prev) => ({ ...prev, azure_databricks_use_identity: false }));
    setScreen("databricks-credentials");
  };

  // -- Context value construction -------------------------------------------
  const value: WizardContextValue = {
    screen, setScreen, goBack,
    selectedCloud, loadingCloud, selectCloud,
    dependencies, installingTerraform, installTerraform, recheckDependencies: checkDependencies, continueFromDependencies,
    templates, selectedTemplate, selectTemplate,
    credentials, setCredentials,
    aws, azure, gcp,
    loadAwsProfiles, handleAwsProfileChange, handleAwsSsoLogin,
    checkAzureAccount, handleAzureLogin, handleAzureSubscriptionChange,
    checkingPermissions,
    showPermissionWarning, setShowPermissionWarning,
    permissionWarningAcknowledged, setPermissionWarningAcknowledged,
    awsValidationAttempted, azureValidationAttempted,
    validateAndContinueFromAwsCredentials,
    validateAndContinueFromAzureCredentials,
    continueFromCloudWithWarning,
    deployment, startDeploymentWizard, confirmAndDeploy,
    cancelDeployment, rollback, resetToWelcome, copyToClipboard,
    ucConfig, setUcConfig, ucPermissionCheck,
    ucPermissionAcknowledged, setUcPermissionAcknowledged,
    ucCheckLoading, ucCheckError, refreshUCPermissions, generateStorageName,
    variables, formValues, setFormValues,
    tagPairs, setTagPairs, showAdvanced, setShowAdvanced,
    formSubmitAttempted, setFormSubmitAttempted,
    loading, error, setError,
  };

  return (
    <WizardContext.Provider value={value}>
      {children}
      {showAzureAdminDialog && credentials.azure_account_email && (
        <AzureAdminDialog
          userEmail={credentials.azure_account_email}
          onYes={handleAzureAdminDialogYes}
          onNo={handleAzureAdminDialogNo}
        />
      )}
    </WizardContext.Provider>
  );
}
