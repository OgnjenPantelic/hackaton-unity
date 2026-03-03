import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AzureAccount, AzureSubscription, AzureVnet, CloudCredentials, CloudPermissionCheck } from "../types";

export interface UseAzureAuthReturn {
  // State
  account: AzureAccount | null;
  subscriptions: AzureSubscription[];
  resourceGroups: { name: string; location: string }[];
  resourceGroupsCacheKey: string;
  vnets: AzureVnet[];
  authMode: "cli" | "service_principal";
  loading: boolean;
  error: string | null;
  permissionCheck: CloudPermissionCheck | null;
  checkingPermissions: boolean;

  // Actions
  setAuthMode: (mode: "cli" | "service_principal") => void;
  setError: (error: string | null) => void;
  setPermissionCheck: (check: CloudPermissionCheck | null) => void;
  setCheckingPermissions: (checking: boolean) => void;
  loadAccount: () => Promise<AzureAccount | null>;
  loadSubscriptions: () => Promise<void>;
  loadResourceGroups: (subscriptionId: string, credentials?: CloudCredentials) => Promise<void>;
  loadVnets: (credentials?: CloudCredentials) => Promise<void>;
  handleAzureLogin: () => Promise<void>;
  handleSubscriptionChange: (
    subscriptionId: string,
    subscriptions: AzureSubscription[],
    setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
  ) => void;
  checkPermissions: (credentials: CloudCredentials) => Promise<CloudPermissionCheck>;
  clearError: () => void;
}

export function useAzureAuth(): UseAzureAuthReturn {
  const [account, setAccount] = useState<AzureAccount | null>(null);
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[]>([]);
  const [resourceGroups, setResourceGroups] = useState<{ name: string; location: string }[]>([]);
  const [resourceGroupsCacheKey, setResourceGroupsCacheKey] = useState<string>("");
  const [vnets, setVnets] = useState<AzureVnet[]>([]);
  const [authMode, setAuthMode] = useState<"cli" | "service_principal">("cli");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionCheck, setPermissionCheck] = useState<CloudPermissionCheck | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const loadAccount = useCallback(async (): Promise<AzureAccount | null> => {
    try {
      const acc = await invoke<AzureAccount | null>("get_azure_account");
      setAccount(acc);
      return acc;
    } catch {
      setAccount(null);
      return null;
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    try {
      const subs = await invoke<AzureSubscription[]>("get_azure_subscriptions");
      setSubscriptions(subs);
    } catch {
      setSubscriptions([]);
    }
  }, []);

  const loadResourceGroups = useCallback(async (subscriptionId: string, credentials?: CloudCredentials) => {
    // Check if we already have cached results for this subscription
    if (resourceGroupsCacheKey === subscriptionId && resourceGroups.length > 0) {
      return;
    }

    try {
      let groups: { name: string; location: string }[];

      // Use SP REST API when in service_principal mode and credentials are provided
      if (authMode === "service_principal" && credentials?.azure_client_id && credentials?.azure_client_secret) {
        groups = await invoke<{ name: string; location: string }[]>("get_azure_resource_groups_sp", {
          credentials,
        });
      } else {
        groups = await invoke<{ name: string; location: string }[]>("get_azure_resource_groups", {
          subscriptionId,
        });
      }

      setResourceGroups(groups);
      setResourceGroupsCacheKey(subscriptionId);
    } catch {
      setResourceGroups([]);
    }
  }, [resourceGroupsCacheKey, resourceGroups.length, authMode]);

  const loadVnets = useCallback(async (credentials?: CloudCredentials) => {
    try {
      let vnetList: AzureVnet[];

      if (authMode === "service_principal" && credentials?.azure_client_id && credentials?.azure_client_secret) {
        vnetList = await invoke<AzureVnet[]>("get_azure_vnets_sp", { credentials });
      } else {
        vnetList = await invoke<AzureVnet[]>("get_azure_vnets");
      }

      setVnets(vnetList);
    } catch {
      setVnets([]);
    }
  }, [authMode]);

  const handleAzureLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke("azure_login");
      const acc = await loadAccount();
      if (acc) {
        await loadSubscriptions();
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [loadAccount, loadSubscriptions]);

  const handleSubscriptionChange = useCallback(
    (
      subscriptionId: string,
      subscriptionsList: AzureSubscription[],
      setCredentials: React.Dispatch<React.SetStateAction<CloudCredentials>>
    ) => {
      const selected = subscriptionsList.find((s) => s.id === subscriptionId);
      if (selected) {
        setCredentials((prev) => ({
          ...prev,
          azure_subscription_id: subscriptionId,
          azure_tenant_id: selected.tenant_id,
        }));
        loadResourceGroups(subscriptionId);
      }
    },
    [loadResourceGroups]
  );

  const checkPermissions = useCallback(
    async (credentials: CloudCredentials): Promise<CloudPermissionCheck> => {
      setCheckingPermissions(true);
      try {
        const check = await invoke<CloudPermissionCheck>("check_azure_permissions", {
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

  return {
    account,
    subscriptions,
    resourceGroups,
    resourceGroupsCacheKey,
    vnets,
    authMode,
    loading,
    error,
    permissionCheck,
    checkingPermissions,
    setAuthMode,
    setError,
    setPermissionCheck,
    setCheckingPermissions,
    loadAccount,
    loadSubscriptions,
    loadResourceGroups,
    loadVnets,
    handleAzureLogin,
    handleSubscriptionChange,
    checkPermissions,
    clearError,
  };
}
