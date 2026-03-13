import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGcpAuth } from "../../hooks/useGcpAuth";
import { CloudCredentials } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("useGcpAuth", () => {
  // ---------------------------------------------------------------------------
  // validateAdc
  // ---------------------------------------------------------------------------
  describe("validateAdc", () => {
    it("sets validation on success with valid result", async () => {
      const validation = {
        valid: true,
        project_id: "my-project",
        account: "user@gcp.com",
        message: "OK",
        oauth_token: "tok-123",
        impersonated_account: null,
      };
      mockInvoke.mockResolvedValueOnce(validation);

      const { result } = renderHook(() => useGcpAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.validateAdc("my-project");
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_gcp_adc", {
        projectId: "my-project",
        serviceAccountEmail: undefined,
      });
      expect(result.current.validation).toEqual(validation);
      expect(result.current.error).toBeNull();
      expect(returned).toEqual(validation);
      expect(result.current.loading).toBe(false);
    });

    it("sets error when validation result is invalid", async () => {
      const validation = {
        valid: false,
        project_id: "my-project",
        account: null,
        message: "Not authenticated",
        oauth_token: null,
        impersonated_account: null,
      };
      mockInvoke.mockResolvedValueOnce(validation);

      const { result } = renderHook(() => useGcpAuth());

      await act(async () => {
        await result.current.validateAdc("my-project");
      });

      expect(result.current.validation).toEqual(validation);
      expect(result.current.error).toBe("Not authenticated");
    });

    it("sets error and fallback validation on invoke error", async () => {
      mockInvoke.mockRejectedValueOnce("ADC failed");

      const { result } = renderHook(() => useGcpAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.validateAdc("my-project");
      });

      expect(returned).toBeNull();
      expect(result.current.error).toBe("ADC failed");
      expect(result.current.validation).toEqual(
        expect.objectContaining({
          valid: false,
          project_id: "my-project",
        })
      );
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // validateServiceAccount
  // ---------------------------------------------------------------------------
  describe("validateServiceAccount", () => {
    it("sets validation on success", async () => {
      const validation = {
        valid: true,
        project_id: "my-project",
        account: "sa@my-project.iam.gserviceaccount.com",
        message: "OK",
        oauth_token: null,
        impersonated_account: null,
      };
      mockInvoke.mockResolvedValueOnce(validation);

      const { result } = renderHook(() => useGcpAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.validateServiceAccount("{}", "my-project");
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_gcp_service_account", {
        jsonContent: "{}",
        projectId: "my-project",
      });
      expect(returned).toEqual(validation);
      expect(result.current.error).toBeNull();
    });

    it("sets error on invoke failure", async () => {
      mockInvoke.mockRejectedValueOnce("Invalid JSON");

      const { result } = renderHook(() => useGcpAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.validateServiceAccount("{bad}", "my-project");
      });

      expect(returned).toBeNull();
      expect(result.current.error).toBe("Invalid JSON");
    });
  });

  // ---------------------------------------------------------------------------
  // checkPermissions
  // ---------------------------------------------------------------------------
  describe("checkPermissions", () => {
    it("returns permission check on success", async () => {
      const check = {
        has_all_permissions: true,
        checked_permissions: ["compute.instances.create"],
        missing_permissions: [],
        message: "OK",
        is_warning: false,
      };
      mockInvoke.mockResolvedValueOnce(check);

      const { result } = renderHook(() => useGcpAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkPermissions({ cloud: "gcp" });
      });

      expect(mockInvoke).toHaveBeenCalledWith("check_gcp_permissions", {
        credentials: { cloud: "gcp" },
      });
      expect(result.current.permissionCheck).toEqual(check);
      expect(returned).toEqual(check);
    });

    it("returns fallback on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useGcpAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkPermissions({ cloud: "gcp" });
      });

      const fallback = returned as { has_all_permissions: boolean; is_warning: boolean };
      expect(fallback.has_all_permissions).toBe(true);
      expect(fallback.is_warning).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // createServiceAccount
  // ---------------------------------------------------------------------------
  describe("createServiceAccount", () => {
    it("creates SA, updates credentials, and validates on success", async () => {
      const createResult = {
        email: "deployer@proj.iam.gserviceaccount.com",
        key_json: '{"type":"service_account"}',
      };
      const validation = {
        valid: true,
        project_id: "proj",
        account: createResult.email,
        message: "OK",
        oauth_token: null,
        impersonated_account: null,
      };

      mockInvoke
        .mockResolvedValueOnce(createResult)   // create_gcp_service_account
        .mockResolvedValueOnce(validation);    // validate_gcp_service_account

      const setCredentials = vi.fn();
      const { result } = renderHook(() => useGcpAuth());

      await act(async () => {
        await result.current.createServiceAccount("proj", "deployer", setCredentials);
      });

      expect(mockInvoke).toHaveBeenCalledWith("create_gcp_service_account", {
        projectId: "proj",
        accountName: "deployer",
      });

      // Verify credentials updated
      expect(setCredentials).toHaveBeenCalled();
      const updater = setCredentials.mock.calls[0][0];
      const updated = updater({} as CloudCredentials);
      expect(updated.gcp_service_account_email).toBe(createResult.email);
      expect(updated.gcp_credentials_json).toBe(createResult.key_json);

      // Verify success state
      expect(result.current.saCreationSuccess).toBe(createResult.email);
      expect(result.current.showCreateSaForm).toBe(false);
      expect(result.current.creatingServiceAccount).toBe(false);
    });

    it("sets saCreationError on failure", async () => {
      mockInvoke.mockRejectedValueOnce("SA creation failed");

      const setCredentials = vi.fn();
      const { result } = renderHook(() => useGcpAuth());

      await act(async () => {
        await result.current.createServiceAccount("proj", "deployer", setCredentials);
      });

      expect(result.current.saCreationError).toBe("SA creation failed");
      expect(result.current.creatingServiceAccount).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // clearValidation
  // ---------------------------------------------------------------------------
  describe("clearValidation", () => {
    it("clears both validation and error", async () => {
      const validation = {
        valid: false,
        project_id: "proj",
        account: null,
        message: "bad",
        oauth_token: null,
        impersonated_account: null,
      };
      mockInvoke.mockResolvedValueOnce(validation);

      const { result } = renderHook(() => useGcpAuth());

      await act(async () => {
        await result.current.validateAdc("proj");
      });
      expect(result.current.validation).not.toBeNull();
      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearValidation();
      });

      expect(result.current.validation).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
