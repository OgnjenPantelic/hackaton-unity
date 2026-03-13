import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { UnityCatalogConfig, UCPermissionCheck, CloudCredentials, Template, AppScreen } from "../types";
import { DEFAULTS } from "../constants";
import { generateRandomSuffix } from "../utils/variables";

export interface UseUnityCatalogReturn {
  ucConfig: UnityCatalogConfig;
  setUcConfig: React.Dispatch<React.SetStateAction<UnityCatalogConfig>>;
  ucPermissionCheck: UCPermissionCheck | null;
  setUcPermissionCheck: (check: UCPermissionCheck | null) => void;
  ucPermissionAcknowledged: boolean;
  setUcPermissionAcknowledged: (acknowledged: boolean) => void;
  ucCheckLoading: boolean;
  ucCheckError: string | null;
  performUCPermissionCheck: () => Promise<void>;
  refreshUCPermissions: () => void;
  generateStorageName: () => string;
  resetUcState: () => void;
  softResetUcState: () => void;
}

export function useUnityCatalog(
  screen: AppScreen,
  selectedTemplate: Template | null,
  formValues: Record<string, any>,
  credentials: CloudCredentials,
  selectedCloud: string
): UseUnityCatalogReturn {
  const [ucConfig, setUcConfig] = useState<UnityCatalogConfig>({
    enabled: false,
    catalog_name: "",
    storage_name: "",
    metastore_id: "",
  });
  const [ucPermissionCheck, setUcPermissionCheck] = useState<UCPermissionCheck | null>(null);
  const [ucPermissionAcknowledged, setUcPermissionAcknowledged] = useState(false);
  const [ucCheckLoading, setUcCheckLoading] = useState(false);
  const [ucCheckError, setUcCheckError] = useState<string | null>(null);

  const performUCPermissionCheck = useCallback(async () => {
    if (!selectedTemplate) { console.debug("[UC] skipped: no template"); return; }

    console.debug("[UC] starting check, cloud=%s, authType=%s, region=%s",
      selectedCloud, credentials.databricks_auth_type,
      formValues.region || formValues.location || formValues.google_region || "(empty)");
    setUcCheckLoading(true);
    setUcCheckError(null);

    try {
      const region = formValues.region || formValues.location || formValues.google_region || "";
      const credsWithCloud = { ...credentials, cloud: selectedCloud };
      console.debug("[UC] invoking check_uc_permissions...");
      const result = await invoke<UCPermissionCheck>("check_uc_permissions", {
        credentials: credsWithCloud,
        region,
      });
      console.debug("[UC] invoke returned, metastore exists=%s", result.metastore?.exists);
      setUcPermissionCheck(result);
      if (result.metastore?.metastore_id) {
        setUcConfig((prev) => ({
          ...prev,
          metastore_id: result.metastore.metastore_id!,
        }));
      }
    } catch (e: unknown) {
      console.error("[UC] invoke failed:", e);
      setUcCheckError(`Failed to check permissions: ${String(e)}`);
    } finally {
      console.debug("[UC] done, setting loading=false");
      setUcCheckLoading(false);
    }
  }, [selectedTemplate, formValues.region, formValues.location, formValues.google_region, credentials, selectedCloud]);

  // Auto-check UC permissions when entering the UC config screen
  useEffect(() => {
    if (screen === "unity-catalog-config" && !ucPermissionCheck && !ucCheckLoading) {
      console.debug("[UC] auto-check triggered (screen=%s, hasResult=%s, loading=%s)", screen, !!ucPermissionCheck, ucCheckLoading);
      performUCPermissionCheck();
    }
  }, [screen, ucPermissionCheck, ucCheckLoading, performUCPermissionCheck]);

  const refreshUCPermissions = useCallback(() => {
    setUcPermissionCheck(null);
    performUCPermissionCheck();
  }, [performUCPermissionCheck]);

  const generateStorageName = useCallback(() => {
    const suffix = generateRandomSuffix().replace(/-/g, "").slice(0, DEFAULTS.SUFFIX_LENGTH);
    return `ucstore${suffix}`;
  }, []);

  const softResetUcState = useCallback(() => {
    setUcPermissionCheck(null);
    setUcCheckError(null);
    setUcPermissionAcknowledged(false);
  }, []);

  const resetUcState = useCallback(() => {
    softResetUcState();
    setUcConfig({ enabled: false, catalog_name: "", storage_name: "", metastore_id: "" });
  }, [softResetUcState]);

  return {
    ucConfig,
    setUcConfig,
    ucPermissionCheck,
    setUcPermissionCheck,
    ucPermissionAcknowledged,
    setUcPermissionAcknowledged,
    ucCheckLoading,
    ucCheckError,
    performUCPermissionCheck,
    refreshUCPermissions,
    generateStorageName,
    resetUcState,
    softResetUcState,
  };
}
