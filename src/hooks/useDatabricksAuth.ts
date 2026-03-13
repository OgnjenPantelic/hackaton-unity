import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DatabricksProfile, CloudCredentials } from "../types";
import { POLLING } from "../constants";
import { useSsoPolling } from "./useSsoPolling";

export interface UseDatabricksAuthReturn {
  // State
  profiles: DatabricksProfile[];
  selectedProfile: string;
  authMode: "profile" | "credentials";
  loading: boolean;
  error: string | null;
  loginAccountId: string;
  showLoginForm: boolean;
  showAddSpProfileForm: boolean;
  addSpProfileData: { accountId: string; clientId: string; clientSecret: string };

  // Actions
  setAuthMode: (mode: "profile" | "credentials") => void;
  setSelectedProfile: (profile: string) => void;
  setLoginAccountId: (id: string) => void;
  setShowLoginForm: (show: boolean) => void;
  setShowAddSpProfileForm: (show: boolean) => void;
  setAddSpProfileData: (data: { accountId: string; clientId: string; clientSecret: string }) => void;
  loadProfiles: () => Promise<DatabricksProfile[]>;
  handleProfileChange: (
    profileName: string,
    profiles: DatabricksProfile[],
    setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
  ) => void;
  handleOAuthLogin: (
    accountId: string,
    setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>,
    onSuccess?: () => void
  ) => Promise<void>;
  handleAddSpProfile: (
    profileName: string,
    data: { accountId: string; clientId: string; clientSecret: string },
    setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
  ) => Promise<void>;
  clearError: () => void;
  cleanup: () => void;
}

export function useDatabricksAuth(): UseDatabricksAuthReturn {
  const [profiles, setProfiles] = useState<DatabricksProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [authMode, setAuthMode] = useState<"profile" | "credentials">("credentials");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginAccountId, setLoginAccountId] = useState<string>("");
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [showAddSpProfileForm, setShowAddSpProfileForm] = useState(false);
  const [addSpProfileData, setAddSpProfileData] = useState({
    accountId: "",
    clientId: "",
    clientSecret: "",
  });

  const { startPolling, clearSsoPolling: clearPolling, cleanup: pollingCleanup } = useSsoPolling();

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const loadProfiles = useCallback(async (): Promise<DatabricksProfile[]> => {
    try {
      const loadedProfiles = await invoke<DatabricksProfile[]>("get_databricks_profiles");
      setProfiles(loadedProfiles);
      return loadedProfiles;
    } catch {
      return [];
    }
  }, []);

  const handleProfileChange = useCallback(
    (
      profileName: string,
      profilesList: DatabricksProfile[],
      setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
    ) => {
      setSelectedProfile(profileName);
      const profile = profilesList.find((p) => p.name === profileName);
      if (profile) {
        setCredentials((prev) => ({
          ...prev,
          databricks_profile: profileName,
          databricks_account_id: profile.account_id || prev.databricks_account_id,
          databricks_auth_type: "profile",
        }));
      }
    },
    []
  );

  const handleOAuthLogin = useCallback(
    async (
      accountId: string,
      setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>,
      onSuccess?: () => void
    ) => {
      setLoading(true);
      setError(null);
      clearPolling();

      try {
        await invoke("databricks_oauth_login", { accountId });

        // Use shared polling hook to wait for the new profile to appear
        let foundProfile: DatabricksProfile | null = null;

        startPolling(
          async () => {
            const newProfiles = await invoke<DatabricksProfile[]>("get_databricks_profiles");
            const accountProfile = newProfiles.find(
              (p) => p.account_id === accountId && (p.has_token || p.has_client_credentials)
            );
            if (accountProfile) {
              foundProfile = accountProfile;
              // Update profiles state while we have the data
              setProfiles(newProfiles);
              return true;
            }
            return false;
          },
          () => {
            if (foundProfile) {
              setSelectedProfile(foundProfile.name);
              setCredentials((prev) => ({
                ...prev,
                databricks_profile: foundProfile!.name,
                databricks_account_id: accountId,
                databricks_auth_type: "profile",
              }));
              setAuthMode("profile");
              setShowLoginForm(false);
              setLoading(false);
              onSuccess?.();
            }
          },
          () => {
            setError("OAuth login timed out. Please try again.");
            setLoading(false);
          },
          {
            interval: POLLING.SSO_CHECK_INTERVAL,
            maxAttempts: POLLING.SSO_MAX_ATTEMPTS,
          }
        );
      } catch (e: unknown) {
        setError(String(e));
        setLoading(false);
      }
    },
    [clearPolling, startPolling]
  );

  const handleAddSpProfile = useCallback(
    async (
      profileName: string,
      data: { accountId: string; clientId: string; clientSecret: string },
      setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
    ) => {
      setLoading(true);
      setError(null);

      try {
        await invoke("add_databricks_sp_profile", {
          profileName,
          accountId: data.accountId,
          clientId: data.clientId,
          clientSecret: data.clientSecret,
        });

        // Reload profiles
        const newProfiles = await loadProfiles();
        const newProfile = newProfiles.find((p) => p.name === profileName);

        if (newProfile) {
          setSelectedProfile(profileName);
          setCredentials((prev) => ({
            ...prev,
            databricks_profile: profileName,
            databricks_account_id: data.accountId,
            databricks_auth_type: "profile",
          }));
          setAuthMode("profile");
          setShowAddSpProfileForm(false);
          setAddSpProfileData({ accountId: "", clientId: "", clientSecret: "" });
        }
      } catch (e: unknown) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [loadProfiles]
  );

  const cleanup = useCallback(() => {
    pollingCleanup();
  }, [pollingCleanup]);

  return {
    profiles,
    selectedProfile,
    authMode,
    loading,
    error,
    loginAccountId,
    showLoginForm,
    showAddSpProfileForm,
    addSpProfileData,
    setAuthMode,
    setSelectedProfile,
    setLoginAccountId,
    setShowLoginForm,
    setShowAddSpProfileForm,
    setAddSpProfileData,
    loadProfiles,
    handleProfileChange,
    handleOAuthLogin,
    handleAddSpProfile,
    clearError,
    cleanup,
  };
}
