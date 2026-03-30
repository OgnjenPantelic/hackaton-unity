import React, { ReactNode } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { WizardContext, WizardContextValue } from "../../context/WizardContext";
import type { UseAwsAuthReturn } from "../../hooks/useAwsAuth";
import type { UseAzureAuthReturn } from "../../hooks/useAzureAuth";
import type { UseGcpAuthReturn } from "../../hooks/useGcpAuth";
import type { UseDeploymentReturn } from "../../hooks/useDeployment";

function stubAwsAuth(overrides: Partial<UseAwsAuthReturn> = {}): UseAwsAuthReturn {
  return {
    profiles: [],
    identity: null,
    vpcs: [],
    authMode: "profile",
    loading: false,
    loginInProgress: false,
    error: null,
    permissionCheck: null,
    checkingPermissions: false,
    setAuthMode: vi.fn(),
    setError: vi.fn(),
    setPermissionCheck: vi.fn(),
    setCheckingPermissions: vi.fn(),
    loadProfiles: vi.fn().mockResolvedValue([]),
    loadVpcs: vi.fn().mockResolvedValue(undefined),
    checkIdentity: vi.fn().mockResolvedValue(undefined),
    handleSsoLogin: vi.fn().mockResolvedValue(undefined),
    cancelSsoLogin: vi.fn().mockResolvedValue(undefined),
    handleProfileChange: vi.fn(),
    checkPermissions: vi.fn().mockResolvedValue({
      has_all_permissions: true,
      checked_permissions: [],
      missing_permissions: [],
      message: "",
      is_warning: false,
    }),
    clearError: vi.fn(),
    cleanup: vi.fn(),
    ...overrides,
  };
}

function stubAzureAuth(overrides: Partial<UseAzureAuthReturn> = {}): UseAzureAuthReturn {
  return {
    account: null,
    subscriptions: [],
    resourceGroups: [],
    resourceGroupsCacheKey: "",
    vnets: [],
    authMode: "cli",
    loading: false,
    loginInProgress: false,
    error: null,
    permissionCheck: null,
    checkingPermissions: false,
    setAuthMode: vi.fn(),
    setError: vi.fn(),
    setPermissionCheck: vi.fn(),
    setCheckingPermissions: vi.fn(),
    loadAccount: vi.fn().mockResolvedValue(null),
    refreshAccount: vi.fn().mockResolvedValue(null),
    loadSubscriptions: vi.fn().mockResolvedValue(undefined),
    loadResourceGroups: vi.fn().mockResolvedValue(undefined),
    loadVnets: vi.fn().mockResolvedValue(undefined),
    handleAzureLogin: vi.fn().mockResolvedValue(undefined),
    cancelLogin: vi.fn().mockResolvedValue(undefined),
    handleSubscriptionChange: vi.fn(),
    checkPermissions: vi.fn().mockResolvedValue({
      has_all_permissions: true,
      checked_permissions: [],
      missing_permissions: [],
      message: "",
      is_warning: false,
    }),
    clearError: vi.fn(),
    ...overrides,
  };
}

function stubGcpAuth(overrides: Partial<UseGcpAuthReturn> = {}): UseGcpAuthReturn {
  return {
    validation: null,
    authMode: "adc",
    loading: false,
    error: null,
    permissionCheck: null,
    checkingPermissions: false,
    creatingServiceAccount: false,
    saCreationError: null,
    saCreationSuccess: null,
    showCreateSaForm: false,
    newSaName: "",
    saSetupMode: "create",
    wantsToChangeSa: false,
    setAuthMode: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setValidation: vi.fn(),
    setPermissionCheck: vi.fn(),
    setCheckingPermissions: vi.fn(),
    validateAdc: vi.fn().mockResolvedValue(null),
    validateServiceAccount: vi.fn().mockResolvedValue(null),
    checkPermissions: vi.fn().mockResolvedValue({
      has_all_permissions: true,
      checked_permissions: [],
      missing_permissions: [],
      message: "",
      is_warning: false,
    }),
    createServiceAccount: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    clearValidation: vi.fn(),
    setCreatingServiceAccount: vi.fn(),
    setSaCreationError: vi.fn(),
    setSaCreationSuccess: vi.fn(),
    setShowCreateSaForm: vi.fn(),
    setNewSaName: vi.fn(),
    setSaSetupMode: vi.fn(),
    setWantsToChangeSa: vi.fn(),
    ...overrides,
  };
}

function stubDeployment(overrides: Partial<UseDeploymentReturn> = {}): UseDeploymentReturn {
  return {
    deploymentStatus: null,
    deploymentStep: "ready",
    showDetailedLogs: false,
    isRollingBack: false,
    templatePath: "",
    deploymentName: "",
    setDeploymentStep: vi.fn(),
    setShowDetailedLogs: vi.fn(),
    setTemplatePath: vi.fn(),
    setDeploymentName: vi.fn(),
    setIsRollingBack: vi.fn(),
    setDeploymentStatus: vi.fn(),
    startPrepare: vi.fn().mockResolvedValue(undefined),
    startApply: vi.fn().mockResolvedValue(undefined),
    pollDeploymentStatus: vi.fn(),
    startRollback: vi.fn().mockResolvedValue(undefined),
    openTemplateFolder: vi.fn().mockResolvedValue(undefined),
    openDeploymentsFolder: vi.fn().mockResolvedValue(undefined),
    clearPollInterval: vi.fn(),
    cleanup: vi.fn(),
    ...overrides,
  };
}

export function createMockWizardContext(
  overrides: Partial<WizardContextValue> = {}
): WizardContextValue {
  return {
    screen: "welcome",
    setScreen: vi.fn(),
    goBack: vi.fn(),

    selectedCloud: "",
    loadingCloud: null,
    selectCloud: vi.fn(),
    cancelCloudSelection: vi.fn(),

    dependencies: {},
    connectivity: {},
    installingTerraform: false,
    installTerraform: vi.fn().mockResolvedValue(undefined),
    recheckDependencies: vi.fn().mockResolvedValue(undefined),
    continueFromDependencies: vi.fn().mockResolvedValue(undefined),

    templates: [],
    selectedTemplate: null,
    loadingTemplate: null,
    selectTemplate: vi.fn().mockResolvedValue(undefined),

    credentials: {},
    setCredentials: vi.fn(),

    aws: stubAwsAuth(overrides.aws),
    azure: stubAzureAuth(overrides.azure),
    gcp: stubGcpAuth(overrides.gcp),

    loadAwsProfiles: vi.fn().mockResolvedValue(undefined),
    handleAwsProfileChange: vi.fn(),
    handleAwsSsoLogin: vi.fn().mockResolvedValue(undefined),

    checkAzureAccount: vi.fn().mockResolvedValue(undefined),
    handleAzureLogin: vi.fn().mockResolvedValue(undefined),
    handleAzureSubscriptionChange: vi.fn().mockResolvedValue(undefined),

    checkingPermissions: false,
    showPermissionWarning: false,
    setShowPermissionWarning: vi.fn(),
    permissionWarningAcknowledged: false,
    setPermissionWarningAcknowledged: vi.fn(),
    awsValidationAttempted: false,
    azureValidationAttempted: false,
    validateAndContinueFromAwsCredentials: vi.fn().mockResolvedValue(undefined),
    validateAndContinueFromAzureCredentials: vi.fn().mockResolvedValue(undefined),
    continueFromCloudWithWarning: vi.fn(),

    deployment: stubDeployment(overrides.deployment),
    startDeploymentWizard: vi.fn().mockResolvedValue(undefined),
    confirmAndDeploy: vi.fn().mockResolvedValue(undefined),
    cancelDeployment: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    resetToWelcome: vi.fn(),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),

    ucConfig: { enabled: false, catalog_name: "", storage_name: "", metastore_id: "" },
    setUcConfig: vi.fn(),
    ucPermissionCheck: null,
    ucPermissionAcknowledged: false,
    setUcPermissionAcknowledged: vi.fn(),
    ucCheckLoading: false,
    ucCheckError: null,
    refreshUCPermissions: vi.fn(),
    generateStorageName: vi.fn().mockReturnValue("storage-test"),

    variables: [],
    formValues: {},
    setFormValues: vi.fn(),
    tagPairs: [],
    setTagPairs: vi.fn(),
    showAdvanced: false,
    setShowAdvanced: vi.fn(),
    formSubmitAttempted: false,
    setFormSubmitAttempted: vi.fn(),

    loading: false,
    error: null,
    setError: vi.fn(),

    ...overrides,
  };
}

export function WizardWrapper({
  children,
  value,
}: {
  children: ReactNode;
  value: WizardContextValue;
}) {
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function renderWithWizard(
  ui: React.ReactElement,
  contextOverrides: Partial<WizardContextValue> = {},
  renderOptions?: Omit<RenderOptions, "wrapper">
) {
  const contextValue = createMockWizardContext(contextOverrides);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WizardWrapper value={contextValue}>{children}</WizardWrapper>
  );
  return {
    ...render(ui, { wrapper, ...renderOptions }),
    contextValue,
  };
}
