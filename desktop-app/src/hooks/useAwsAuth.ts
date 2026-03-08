import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AwsProfile, AwsIdentity, CloudCredentials, CloudPermissionCheck } from "../types";
import { POLLING } from "../constants";
import { useSsoPolling } from "./useSsoPolling";

export interface UseAwsAuthReturn {
  // State
  profiles: AwsProfile[];
  identity: AwsIdentity | null;
  authMode: "profile" | "keys";
  loading: boolean;
  loginInProgress: boolean;
  error: string | null;
  permissionCheck: CloudPermissionCheck | null;
  checkingPermissions: boolean;

  // Actions
  setAuthMode: (mode: "profile" | "keys") => void;
  setError: (error: string | null) => void;
  setPermissionCheck: (check: CloudPermissionCheck | null) => void;
  setCheckingPermissions: (checking: boolean) => void;
  loadProfiles: () => Promise<AwsProfile[]>;
  checkIdentity: (profile: string) => Promise<void>;
  handleSsoLogin: (profile: string) => Promise<void>;
  cancelSsoLogin: () => Promise<void>;
  handleProfileChange: (
    profile: string,
    setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
  ) => void;
  checkPermissions: (credentials: CloudCredentials) => Promise<CloudPermissionCheck>;
  clearError: () => void;
  cleanup: () => void;
}

export function useAwsAuth(): UseAwsAuthReturn {
  const [profiles, setProfiles] = useState<AwsProfile[]>([]);
  const [identity, setIdentity] = useState<AwsIdentity | null>(null);
  const [authMode, setAuthMode] = useState<"profile" | "keys">("profile");
  const [loading, setLoading] = useState(false);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionCheck, setPermissionCheck] = useState<CloudPermissionCheck | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(false);

  const { startPolling, clearSsoPolling, isMountedRef, setMounted } = useSsoPolling();

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const loadedProfiles = await invoke<AwsProfile[]>("get_aws_profiles");
      setProfiles(loadedProfiles);
      if (loadedProfiles.length === 0) {
        setAuthMode("keys");
      }
      return loadedProfiles;
    } catch {
      setAuthMode("keys");
      return [];
    }
  }, []);

  const checkIdentity = useCallback(async (profile: string) => {
    setLoading(true);
    setError(null);
    setIdentity(null);
    try {
      const id = await invoke<AwsIdentity>("get_aws_identity", { profile });
      setIdentity(id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleProfileChange = useCallback(
    (
      profile: string,
      setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
    ) => {
      setCredentials((prev) => ({ ...prev, aws_profile: profile }));
      setIdentity(null);
      setError(null);
      checkIdentity(profile);
    },
    [checkIdentity]
  );

  const handleSsoLogin = useCallback(
    async (profile: string) => {
      setLoading(true);
      setLoginInProgress(true);
      setError(null);
      clearSsoPolling();

      try {
        await invoke("aws_sso_login", { profile });

        setLoginInProgress(false);
        startPolling(
          async () => {
            const id = await invoke<AwsIdentity>("get_aws_identity", { profile });
            if (isMountedRef.current) {
              setIdentity(id);
              setLoading(false);
            }
            return true;
          },
          () => {
            // Success handled in checkFn
          },
          () => {
            setError("SSO authentication timed out. Please try again.");
            setLoading(false);
          },
          {
            interval: POLLING.SSO_CHECK_INTERVAL,
            maxAttempts: POLLING.SSO_MAX_ATTEMPTS,
          }
        );
      } catch (e: unknown) {
        const msg = String(e);
        if (msg !== "LOGIN_CANCELLED") {
          setError(msg);
        }
        setLoginInProgress(false);
        setLoading(false);
      }
    },
    [clearSsoPolling, startPolling, isMountedRef]
  );

  const cancelSsoLogin = useCallback(async () => {
    try {
      await invoke("cancel_cli_login");
    } catch {
      // Best-effort cancellation
    }
    setLoginInProgress(false);
    clearSsoPolling();
  }, [clearSsoPolling]);

  const checkPermissions = useCallback(
    async (credentials: CloudCredentials): Promise<CloudPermissionCheck> => {
      setCheckingPermissions(true);
      try {
        const check = await invoke<CloudPermissionCheck>("check_aws_permissions", {
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

  const cleanup = useCallback(() => {
    setMounted(false);
    clearSsoPolling();
  }, [setMounted, clearSsoPolling]);

  return {
    profiles,
    identity,
    authMode,
    loading,
    loginInProgress,
    error,
    permissionCheck,
    checkingPermissions,
    setAuthMode,
    setError,
    setPermissionCheck,
    setCheckingPermissions,
    loadProfiles,
    checkIdentity,
    handleSsoLogin,
    cancelSsoLogin,
    handleProfileChange,
    checkPermissions,
    clearError,
    cleanup,
  };
}
