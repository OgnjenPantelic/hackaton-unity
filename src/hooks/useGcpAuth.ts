import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GcpValidation, CloudCredentials, CloudPermissionCheck } from "../types";

export interface UseGcpAuthReturn {
  // State
  validation: GcpValidation | null;
  authMode: "adc" | "service_account";
  loading: boolean;
  error: string | null;
  permissionCheck: CloudPermissionCheck | null;
  checkingPermissions: boolean;

  // SA Creation states
  creatingServiceAccount: boolean;
  saCreationError: string | null;
  saCreationSuccess: string | null;
  showCreateSaForm: boolean;
  newSaName: string;
  saSetupMode: "create" | "existing";
  wantsToChangeSa: boolean;

  // Actions
  setAuthMode: (mode: "adc" | "service_account") => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setValidation: (validation: GcpValidation | null) => void;
  setPermissionCheck: (check: CloudPermissionCheck | null) => void;
  setCheckingPermissions: (checking: boolean) => void;
  validateAdc: (projectId: string, serviceAccountEmail?: string) => Promise<GcpValidation | null>;
  validateServiceAccount: (jsonContent: string, projectId: string) => Promise<GcpValidation | null>;
  checkPermissions: (credentials: CloudCredentials) => Promise<CloudPermissionCheck>;
  clearError: () => void;
  clearValidation: () => void;

  // SA Creation actions
  setCreatingServiceAccount: (value: boolean) => void;
  setSaCreationError: (value: string | null) => void;
  setSaCreationSuccess: (value: string | null) => void;
  setShowCreateSaForm: (value: boolean) => void;
  setNewSaName: (value: string) => void;
  setSaSetupMode: (mode: "create" | "existing") => void;
  setWantsToChangeSa: (value: boolean) => void;
  createServiceAccount: (
    projectId: string,
    accountName: string,
    setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
  ) => Promise<void>;
}

export function useGcpAuth(): UseGcpAuthReturn {
  const [validation, setValidation] = useState<GcpValidation | null>(null);
  const [authMode, setAuthMode] = useState<"adc" | "service_account">("adc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionCheck, setPermissionCheck] = useState<CloudPermissionCheck | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(false);

  // SA Creation states
  const [creatingServiceAccount, setCreatingServiceAccount] = useState(false);
  const [saCreationError, setSaCreationError] = useState<string | null>(null);
  const [saCreationSuccess, setSaCreationSuccess] = useState<string | null>(null);
  const [showCreateSaForm, setShowCreateSaForm] = useState(false);
  const [newSaName, setNewSaName] = useState("databricks-deployer");
  const [saSetupMode, setSaSetupMode] = useState<"create" | "existing">("create");
  const [wantsToChangeSa, setWantsToChangeSa] = useState(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearValidation = useCallback(() => {
    setValidation(null);
    setError(null);
  }, []);

  const validateAdc = useCallback(
    async (projectId: string, serviceAccountEmail?: string): Promise<GcpValidation | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<GcpValidation>("validate_gcp_adc", {
          projectId,
          serviceAccountEmail,
        });
        setValidation(result);
        if (!result.valid) {
          setError(result.message);
        }
        return result;
      } catch (e: unknown) {
        const errorMsg = String(e);
        setError(errorMsg);
        setValidation({
          valid: false,
          project_id: projectId,
          account: null,
          message: errorMsg,
          oauth_token: null,
          impersonated_account: null,
        });
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const validateServiceAccount = useCallback(
    async (jsonContent: string, projectId: string): Promise<GcpValidation | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<GcpValidation>("validate_gcp_service_account", {
          jsonContent,
          projectId,
        });
        setValidation(result);
        if (!result.valid) {
          setError(result.message);
        }
        return result;
      } catch (e: unknown) {
        const errorMsg = String(e);
        setError(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const checkPermissions = useCallback(
    async (credentials: CloudCredentials): Promise<CloudPermissionCheck> => {
      setCheckingPermissions(true);
      try {
        const check = await invoke<CloudPermissionCheck>("check_gcp_permissions", {
          credentials,
        });
        setPermissionCheck(check);
        return check;
      } catch {
        const fallback: CloudPermissionCheck = {
          has_all_permissions: true,
          checked_permissions: [],
          missing_permissions: [],
          message: "Permission check skipped due to an error.",
          is_warning: true,
        };
        setPermissionCheck(fallback);
        return fallback;
      } finally {
        setCheckingPermissions(false);
      }
    },
    []
  );

  const createServiceAccount = useCallback(
    async (
      projectId: string,
      accountName: string,
      setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
    ) => {
      setCreatingServiceAccount(true);
      setSaCreationError(null);
      setSaCreationSuccess(null);

      try {
        // Create SA and get the key
        const result = await invoke<{ email: string; key_json: string }>("create_gcp_service_account", {
          projectId,
          accountName,
        });

        // Update credentials with the new SA
        setCredentials((prev) => ({
          ...prev,
          gcp_service_account_email: result.email,
          gcp_credentials_json: result.key_json,
        }));

        setSaCreationSuccess(result.email);
        setShowCreateSaForm(false);

        // Validate the new SA
        const validationResult = await validateServiceAccount(result.key_json, projectId);
        if (validationResult?.valid) {
          setAuthMode("service_account");
        }
      } catch (e: unknown) {
        setSaCreationError(String(e));
      } finally {
        setCreatingServiceAccount(false);
      }
    },
    [validateServiceAccount]
  );

  return {
    validation,
    authMode,
    loading,
    error,
    permissionCheck,
    checkingPermissions,
    creatingServiceAccount,
    saCreationError,
    saCreationSuccess,
    showCreateSaForm,
    newSaName,
    saSetupMode,
    wantsToChangeSa,
    setAuthMode,
    setLoading,
    setError,
    setValidation,
    setPermissionCheck,
    setCheckingPermissions,
    validateAdc,
    validateServiceAccount,
    checkPermissions,
    clearError,
    clearValidation,
    setCreatingServiceAccount,
    setSaCreationError,
    setSaCreationSuccess,
    setShowCreateSaForm,
    setNewSaName,
    setSaSetupMode,
    setWantsToChangeSa,
    createServiceAccount,
  };
}
