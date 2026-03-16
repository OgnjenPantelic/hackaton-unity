import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useUnityCatalog } from "../../hooks/useUnityCatalog";
import { UCPermissionCheck, Template, CloudCredentials, AppScreen } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

const template: Template = {
  id: "azure-simple",
  name: "Azure Simple",
  cloud: "azure",
  description: "Simple Azure workspace",
  features: ["vnet"],
  github_url: "https://github.com/OgnjenPantelic/workspace-creator/tree/main/src-tauri/templates/azure-simple",
};

const credentials: CloudCredentials = {
  azure_tenant_id: "tenant-123",
  azure_subscription_id: "sub-456",
};

const permCheckWithMetastore: UCPermissionCheck = {
  metastore: {
    exists: true,
    metastore_id: "meta-abc",
    metastore_name: "main-metastore",
    region: "eastus2",
  },
  has_create_catalog: true,
  has_create_external_location: true,
  has_create_storage_credential: true,
  can_create_catalog: true,
  message: "All permissions granted",
};

const permCheckNoMetastore: UCPermissionCheck = {
  metastore: {
    exists: false,
    metastore_id: null,
    metastore_name: null,
    region: null,
  },
  has_create_catalog: false,
  has_create_external_location: false,
  has_create_storage_credential: false,
  can_create_catalog: true,
  message: "No metastore found — one will be created",
};

function renderUnityCatalog(
  overrides: {
    screen?: AppScreen;
    template?: Template | null;
    formValues?: Record<string, any>;
    credentials?: CloudCredentials;
    cloud?: string;
  } = {}
) {
  const {
    screen = "configuration",
    template: tmpl = template,
    formValues = {},
    credentials: creds = credentials,
    cloud = "azure",
  } = overrides;

  return renderHook(() =>
    useUnityCatalog(screen, tmpl, formValues, creds, cloud)
  );
}

describe("useUnityCatalog", () => {
  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("starts with UC disabled and empty values", () => {
      const { result } = renderUnityCatalog();

      expect(result.current.ucConfig).toEqual({
        enabled: false,
        catalog_name: "",
        storage_name: "",
        metastore_id: "",
      });
      expect(result.current.ucPermissionCheck).toBeNull();
      expect(result.current.ucPermissionAcknowledged).toBe(false);
      expect(result.current.ucCheckLoading).toBe(false);
      expect(result.current.ucCheckError).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // performUCPermissionCheck
  // ---------------------------------------------------------------------------
  describe("performUCPermissionCheck", () => {
    it("checks permissions and stores result", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckWithMetastore);

      const { result } = renderUnityCatalog();

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(mockInvoke).toHaveBeenCalledWith("check_uc_permissions", {
        credentials: { ...credentials, cloud: "azure" },
        region: "",
      });
      expect(result.current.ucPermissionCheck).toEqual(permCheckWithMetastore);
      expect(result.current.ucCheckLoading).toBe(false);
      expect(result.current.ucCheckError).toBeNull();
    });

    it("extracts metastore_id from result into ucConfig", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckWithMetastore);

      const { result } = renderUnityCatalog();

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(result.current.ucConfig.metastore_id).toBe("meta-abc");
    });

    it("does not set metastore_id when no metastore exists", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckNoMetastore);

      const { result } = renderUnityCatalog();

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(result.current.ucConfig.metastore_id).toBe("");
    });

    it("uses region from formValues (location)", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckNoMetastore);

      const { result } = renderUnityCatalog({
        formValues: { location: "westus" },
      });

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(mockInvoke).toHaveBeenCalledWith("check_uc_permissions", {
        credentials: expect.any(Object),
        region: "westus",
      });
    });

    it("uses region from formValues (google_region)", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckNoMetastore);

      const { result } = renderUnityCatalog({
        formValues: { google_region: "us-central1" },
        cloud: "gcp",
      });

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(mockInvoke).toHaveBeenCalledWith("check_uc_permissions", {
        credentials: expect.objectContaining({ cloud: "gcp" }),
        region: "us-central1",
      });
    });

    it("sets error on invoke failure", async () => {
      mockInvoke.mockRejectedValueOnce("Network error");

      const { result } = renderUnityCatalog();

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(result.current.ucCheckError).toBe("Failed to check permissions: Network error");
      expect(result.current.ucCheckLoading).toBe(false);
      expect(result.current.ucPermissionCheck).toBeNull();
    });

    it("does nothing when no template is selected", async () => {
      const { result } = renderUnityCatalog({ template: null });

      await act(async () => {
        await result.current.performUCPermissionCheck();
      });

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(result.current.ucCheckLoading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-check on UC config screen
  // ---------------------------------------------------------------------------
  describe("auto-check on UC config screen", () => {
    it("auto-checks when entering unity-catalog-config screen", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckWithMetastore);

      renderUnityCatalog({ screen: "unity-catalog-config" });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("check_uc_permissions", expect.any(Object));
      });
    });

    it("does not auto-check on other screens", () => {
      renderUnityCatalog({ screen: "configuration" });

      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // refreshUCPermissions
  // ---------------------------------------------------------------------------
  describe("refreshUCPermissions", () => {
    it("clears previous check and re-checks", async () => {
      mockInvoke
        .mockResolvedValueOnce(permCheckWithMetastore)
        .mockResolvedValueOnce(permCheckNoMetastore);

      const { result } = renderUnityCatalog();

      // First check
      await act(async () => {
        await result.current.performUCPermissionCheck();
      });
      expect(result.current.ucPermissionCheck).toEqual(permCheckWithMetastore);

      // Refresh
      await act(async () => {
        result.current.refreshUCPermissions();
      });

      await waitFor(() => {
        expect(result.current.ucPermissionCheck).toEqual(permCheckNoMetastore);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // generateStorageName
  // ---------------------------------------------------------------------------
  describe("generateStorageName", () => {
    it("returns a name starting with 'ucstore'", () => {
      const { result } = renderUnityCatalog();

      const name = result.current.generateStorageName();
      expect(name).toMatch(/^ucstore[a-z0-9]+$/);
    });

    it("generates different names on consecutive calls", () => {
      const { result } = renderUnityCatalog();

      const name1 = result.current.generateStorageName();
      const name2 = result.current.generateStorageName();
      expect(name1).not.toBe(name2);
    });
  });

  // ---------------------------------------------------------------------------
  // resetUcState
  // ---------------------------------------------------------------------------
  describe("resetUcState", () => {
    it("resets all UC state to defaults", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckWithMetastore);

      const { result } = renderUnityCatalog();

      // Set up some state
      await act(async () => {
        await result.current.performUCPermissionCheck();
      });
      act(() => {
        result.current.setUcPermissionAcknowledged(true);
        result.current.setUcConfig({
          enabled: true,
          catalog_name: "main",
          storage_name: "store",
          metastore_id: "meta-abc",
        });
      });

      // Reset
      act(() => {
        result.current.resetUcState();
      });

      expect(result.current.ucConfig).toEqual({
        enabled: false,
        catalog_name: "",
        storage_name: "",
        metastore_id: "",
      });
      expect(result.current.ucPermissionCheck).toBeNull();
      expect(result.current.ucPermissionAcknowledged).toBe(false);
      expect(result.current.ucCheckError).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // softResetUcState
  // ---------------------------------------------------------------------------
  describe("softResetUcState", () => {
    it("clears transient state but preserves ucConfig", async () => {
      mockInvoke.mockResolvedValueOnce(permCheckWithMetastore);

      const { result } = renderUnityCatalog();

      // Set up: perform check, acknowledge, configure
      await act(async () => {
        await result.current.performUCPermissionCheck();
      });
      act(() => {
        result.current.setUcPermissionAcknowledged(true);
        result.current.setUcConfig({
          enabled: true,
          catalog_name: "my-catalog",
          storage_name: "my-storage",
          metastore_id: "meta-abc",
        });
      });

      // Soft reset
      act(() => {
        result.current.softResetUcState();
      });

      // Transient state is cleared
      expect(result.current.ucPermissionCheck).toBeNull();
      expect(result.current.ucPermissionAcknowledged).toBe(false);
      expect(result.current.ucCheckError).toBeNull();

      // User-entered config is preserved
      expect(result.current.ucConfig).toEqual({
        enabled: true,
        catalog_name: "my-catalog",
        storage_name: "my-storage",
        metastore_id: "meta-abc",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // setUcConfig
  // ---------------------------------------------------------------------------
  describe("setUcConfig", () => {
    it("updates UC configuration", () => {
      const { result } = renderUnityCatalog();

      act(() => {
        result.current.setUcConfig({
          enabled: true,
          catalog_name: "my-catalog",
          storage_name: "my-storage",
          metastore_id: "",
        });
      });

      expect(result.current.ucConfig.enabled).toBe(true);
      expect(result.current.ucConfig.catalog_name).toBe("my-catalog");
    });
  });

  // ---------------------------------------------------------------------------
  // setUcPermissionAcknowledged
  // ---------------------------------------------------------------------------
  describe("setUcPermissionAcknowledged", () => {
    it("updates acknowledged flag", () => {
      const { result } = renderUnityCatalog();

      act(() => {
        result.current.setUcPermissionAcknowledged(true);
      });
      expect(result.current.ucPermissionAcknowledged).toBe(true);

      act(() => {
        result.current.setUcPermissionAcknowledged(false);
      });
      expect(result.current.ucPermissionAcknowledged).toBe(false);
    });
  });
});
