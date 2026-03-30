import { createContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DependencyStatus,
  Template,
  TerraformVariable,
  DeploymentStatus,
  CloudCredentials,
  CloudPermissionCheck,
  AppScreen,
  UnityCatalogConfig,
  UCPermissionCheck,
} from "../types";
import { CLOUDS, POLLING, UI } from "../constants";
import { initializeFormDefaults, generateRandomSuffix } from "../utils/variables";
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
import { validateAwsCredentials, validateAzureCredentials, CloudValidationResult } from "../utils/cloudValidation";
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
  cancelCloudSelection: () => void;

  // Dependencies
  dependencies: Record<string, DependencyStatus>;
  connectivity: Record<string, boolean>;
  installingTerraform: boolean;
  installTerraform: () => Promise<void>;
  recheckDependencies: () => Promise<void>;
  continueFromDependencies: () => Promise<void>;

  // Templates
  templates: Template[];
  selectedTemplate: Template | null;
  loadingTemplate: string | null;
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
  const [connectivity, setConnectivity] = useState<Record<string, boolean>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCloud, setSelectedCloud] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variables, setVariables] = useState<TerraformVariable[]>([]);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [credentials, setCredentials] = useState<CloudCredentials>({});
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingTerraform, setInstallingTerraform] = useState(false);
  const [loadingCloud, setLoadingCloud] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const templateRequestRef = useRef<string | null>(null);
  const cloudRequestRef = useRef<string | null>(null);
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
    refreshUCPermissions, generateStorageName, resetUcState, softResetUcState,
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
    } catch (e) {
      console.warn("Failed to load templates:", e);
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
      const [deps, conn] = await Promise.all([
        invoke<Record<string, DependencyStatus>>("check_dependencies"),
        invoke<Record<string, boolean>>("check_terraform_connectivity").catch(() => ({})),
      ]);
      setDependencies(deps);
      setConnectivity(conn);
    } catch (e) {
      console.warn("Failed to check dependencies:", e);
    }
  };

  const loadAzureResourceGroups = async () => {
    const subscriptionId = credentials.azure_subscription_id || "";
    if (subscriptionId) {
      await azure.loadResourceGroups(subscriptionId, credentials);
    }
  };

  const loadAzureVnets = async () => {
    const subscriptionId = credentials.azure_subscription_id || "";
    if (subscriptionId) {
      await azure.loadVnets(subscriptionId, credentials);
    }
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
    const requestId = cloud + Date.now();
    cloudRequestRef.current = requestId;
    setLoadingCloud(cloud);
    setSelectedCloud(cloud);
    deployment.setDeploymentName("");
    
    // Clear all cloud-specific credentials when switching clouds
    setCredentials(prev => {
      const base = {
        cloud,
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
      if (cloudRequestRef.current !== requestId) return;
      setLoadingCloud(null);
      setScreen("dependencies");
    }, UI.REACT_PAINT_DELAY);
  };

  const cancelCloudSelection = () => {
    cloudRequestRef.current = null;
    setLoadingCloud(null);
    setSelectedCloud("");
  };

  const selectTemplate = async (template: Template) => {
    const isSameTemplate = selectedTemplate?.id === template.id;
    const hasExistingValues = Object.keys(formValues).length > 0;
    const requestId = template.id;

    templateRequestRef.current = requestId;
    setSelectedTemplate(template);
    setLoadingTemplate(template.id);
    setLoading(true);
    setFormSubmitAttempted(false);

    if (!isSameTemplate) {
      deployment.setDeploymentName("");
    }

    setTimeout(async () => {
      try {
        const [vars] = await Promise.all([
          invoke<TerraformVariable[]>("get_template_variables", {
            templateId: template.id,
          }),
          new Promise((resolve) => setTimeout(resolve, POLLING.MIN_LOADING_TIME)),
        ]);

        if (templateRequestRef.current !== requestId) return;

        setVariables(vars);

        if (!isSameTemplate || !hasExistingValues) {
          const defaults = initializeFormDefaults(vars, {
            azureUser: azure.account?.user,
            gcpAccount: gcp.validation?.account,
          });
          const templateTagValue = `${template.id.replace(/-/g, "_")}_${generateRandomSuffix()}`;
          const defaultTag = { key: "databricks_deployer_template", value: templateTagValue };
          defaults.tags = JSON.stringify({ [defaultTag.key]: defaultTag.value });
          setFormValues(defaults);
          setTagPairs([defaultTag]);
        }

        if (selectedCloud === CLOUDS.AZURE) {
          loadAzureResourceGroups();
          loadAzureVnets();
        }
        if (selectedCloud === CLOUDS.AWS) {
          aws.loadVpcs(credentialsRef.current);
        }
      } catch (e: unknown) {
        if (templateRequestRef.current !== requestId) return;
        setError(`Failed to load template: ${String(e)}`);
      } finally {
        if (templateRequestRef.current === requestId) {
          setLoading(false);
          setLoadingTemplate(null);
        }
      }
      if (templateRequestRef.current === requestId) {
        setScreen("configuration");
      }
    }, UI.REACT_PAINT_DELAY);
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
    if (selectedCloud === CLOUDS.AZURE && azure.authMode === "cli") {
      setShowAzureAdminDialog(true);
    } else if (selectedCloud === CLOUDS.AZURE) {
      setCredentials((prev) => ({ ...prev, azure_databricks_use_identity: false }));
      setScreen("databricks-credentials");
    } else {
      setScreen("databricks-credentials");
    }
  }, [selectedCloud, azure.authMode]);

  // -- AWS wrappers ---------------------------------------------------------
  const loadAwsProfiles = useCallback(async () => {
    const profiles = await aws.loadProfiles();
    if (profiles.length > 0) {
      const currentProfile = credentialsRef.current.aws_profile;
      const stillExists = currentProfile && profiles.some((p) => p.name === currentProfile);
      const activeProfile = stillExists
        ? currentProfile
        : (profiles.find((p) => p.name === "default") || profiles[0]).name;
      if (activeProfile !== credentialsRef.current.aws_profile) {
        setCredentials((prev) => ({ ...prev, aws_profile: activeProfile }));
      }
      aws.checkIdentity(activeProfile);
    }
  }, [aws, setCredentials]);

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
  const applyAzureAccount = async (account: NonNullable<Awaited<ReturnType<typeof azure.loadAccount>>>) => {
    setCredentials((prev) => ({
      ...prev,
      azure_tenant_id: account.tenant_id,
      azure_subscription_id: account.subscription_id,
      azure_account_email: account.user,
    }));
    await azure.loadSubscriptions();
  };

  const checkAzureAccount = async () => {
    const account = await azure.refreshAccount();
    if (account) await applyAzureAccount(account);
  };

  const handleAzureLogin = async () => {
    await azure.handleAzureLogin();
    const account = await azure.loadAccount();
    if (account) await applyAzureAccount(account);
  };

  const handleAzureSubscriptionChange = async (subscriptionId: string) => {
    // Set CLI active subscription first so subsequent CLI commands target the right subscription
    try {
      await invoke("set_azure_subscription", { subscriptionId });
    } catch {
      // Subscription switch failed — user can retry
    }
    azure.handleSubscriptionChange(subscriptionId, azure.subscriptions, setCredentials);
    setShowPermissionWarning(false);
    setPermissionWarningAcknowledged(false);
    azure.setPermissionCheck(null);
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
    gcp.setError(null);
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
          loadAwsProfiles();
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
        softResetUcState();
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
  const validateAndContinueFromCloud = async (
    cloudHook: { setError: (e: string | null) => void; setCheckingPermissions: (c: boolean) => void; setPermissionCheck: (p: CloudPermissionCheck | null) => void },
    setAttempted: (v: boolean) => void,
    validate: () => Promise<CloudValidationResult>,
    onSuccess: () => void,
  ) => {
    setAttempted(true);
    cloudHook.setError(null);
    cloudHook.setCheckingPermissions(true);

    const result = await validate();

    cloudHook.setCheckingPermissions(false);

    if (result.error) {
      cloudHook.setError(result.error);
      return;
    }

    if (result.permissionWarning && result.permissionCheck) {
      cloudHook.setPermissionCheck(result.permissionCheck);
      setShowPermissionWarning(true);
      setPermissionWarningAcknowledged(false);
      return;
    }

    if (result.permissionCheck) {
      cloudHook.setPermissionCheck(result.permissionCheck);
    }

    onSuccess();
  };

  const validateAndContinueFromAwsCredentials = () =>
    validateAndContinueFromCloud(
      aws,
      setAwsValidationAttempted,
      () => validateAwsCredentials({ authMode: aws.authMode, identity: aws.identity, credentials }),
      () => setScreen("databricks-credentials"),
    );

  const validateAndContinueFromAzureCredentials = () =>
    validateAndContinueFromCloud(
      azure,
      setAzureValidationAttempted,
      () => validateAzureCredentials({ authMode: azure.authMode, account: azure.account, credentials }),
      () => {
        if (azure.authMode === "cli") {
          setShowAzureAdminDialog(true);
        } else {
          setCredentials((prev) => ({ ...prev, azure_databricks_use_identity: false }));
          setScreen("databricks-credentials");
        }
      },
    );

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
    selectedCloud, loadingCloud, selectCloud, cancelCloudSelection,
    dependencies, connectivity, installingTerraform, installTerraform, recheckDependencies: checkDependencies, continueFromDependencies,
    templates, selectedTemplate, loadingTemplate, selectTemplate,
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
      {showAzureAdminDialog && (
        <AzureAdminDialog
          userEmail={credentials.azure_account_email || "your Azure account"}
          onYes={handleAzureAdminDialogYes}
          onNo={handleAzureAdminDialogNo}
        />
      )}
    </WizardContext.Provider>
  );
}
