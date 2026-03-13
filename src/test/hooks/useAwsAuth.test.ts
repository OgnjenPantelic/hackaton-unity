import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAwsAuth } from "../../hooks/useAwsAuth";
import { CloudCredentials } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("useAwsAuth", () => {
  // ---------------------------------------------------------------------------
  // loadProfiles
  // ---------------------------------------------------------------------------
  describe("loadProfiles", () => {
    it("loads profiles and updates state on success", async () => {
      const profiles = [
        { name: "default", is_sso: false },
        { name: "dev", is_sso: true },
      ];
      mockInvoke.mockResolvedValueOnce(profiles);

      const { result } = renderHook(() => useAwsAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.loadProfiles();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_aws_profiles");
      expect(result.current.profiles).toEqual(profiles);
      expect(returned).toEqual(profiles);
      expect(result.current.authMode).toBe("profile"); // stays profile
    });

    it("switches to keys mode when profiles are empty", async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.loadProfiles();
      });

      expect(result.current.authMode).toBe("keys");
    });

    it("switches to keys mode and returns [] on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useAwsAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.loadProfiles();
      });

      expect(result.current.authMode).toBe("keys");
      expect(returned).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // checkIdentity
  // ---------------------------------------------------------------------------
  describe("checkIdentity", () => {
    it("sets identity on success and manages loading state", async () => {
      const identity = { account: "123", arn: "arn:aws:iam::123", user_id: "AIDA" };
      mockInvoke.mockResolvedValueOnce(identity);

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.checkIdentity("default");
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_aws_identity", { profile: "default" });
      expect(result.current.identity).toEqual(identity);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce("STS error");

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.checkIdentity("bad-profile");
      });

      expect(result.current.identity).toBeNull();
      expect(result.current.error).toBe("STS error");
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // handleProfileChange
  // ---------------------------------------------------------------------------
  describe("handleProfileChange", () => {
    it("updates credentials and triggers identity check", async () => {
      const identity = { account: "123", arn: "arn:test", user_id: "AIDA" };
      mockInvoke.mockResolvedValueOnce(identity);

      const setCredentials = vi.fn();
      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        result.current.handleProfileChange("my-profile", setCredentials);
      });

      expect(setCredentials).toHaveBeenCalled();
      // The setter receives a function; call it to verify the update
      const updater = setCredentials.mock.calls[0][0];
      const updated = updater({ cloud: "aws" } as CloudCredentials);
      expect(updated.aws_profile).toBe("my-profile");

      // checkIdentity should have been called
      expect(mockInvoke).toHaveBeenCalledWith("get_aws_identity", { profile: "my-profile" });
    });
  });

  // ---------------------------------------------------------------------------
  // checkPermissions
  // ---------------------------------------------------------------------------
  describe("checkPermissions", () => {
    it("returns permission check on success", async () => {
      const check = {
        has_all_permissions: true,
        checked_permissions: ["ec2:*"],
        missing_permissions: [],
        message: "All good",
        is_warning: false,
      };
      mockInvoke.mockResolvedValueOnce(check);

      const { result } = renderHook(() => useAwsAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkPermissions({ cloud: "aws" });
      });

      expect(mockInvoke).toHaveBeenCalledWith("check_aws_permissions", {
        credentials: { cloud: "aws" },
      });
      expect(result.current.permissionCheck).toEqual(check);
      expect(returned).toEqual(check);
      expect(result.current.checkingPermissions).toBe(false);
    });

    it("returns a fallback with has_all_permissions true on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useAwsAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkPermissions({ cloud: "aws" });
      });

      const fallback = returned as { has_all_permissions: boolean; is_warning: boolean };
      expect(fallback.has_all_permissions).toBe(true);
      expect(fallback.is_warning).toBe(true);
      expect(result.current.checkingPermissions).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // clearError
  // ---------------------------------------------------------------------------
  describe("clearError", () => {
    it("clears the error state", async () => {
      mockInvoke.mockRejectedValueOnce("some error");

      const { result } = renderHook(() => useAwsAuth());

      // Trigger an error
      await act(async () => {
        await result.current.checkIdentity("bad");
      });
      expect(result.current.error).not.toBeNull();

      // Clear it
      act(() => {
        result.current.clearError();
      });
      expect(result.current.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // setPermissionCheck
  // ---------------------------------------------------------------------------
  describe("setPermissionCheck", () => {
    it("updates permission check state", () => {
      const { result } = renderHook(() => useAwsAuth());

      const permCheck = {
        has_all_permissions: false,
        checked_permissions: ["ec2:*"],
        missing_permissions: ["iam:CreateRole"],
        message: "Missing permissions",
        is_warning: false,
      };

      act(() => {
        result.current.setPermissionCheck(permCheck);
      });

      expect(result.current.permissionCheck).toEqual(permCheck);
    });

    it("can reset permission check to null", () => {
      const { result } = renderHook(() => useAwsAuth());

      const permCheck = {
        has_all_permissions: false,
        checked_permissions: ["ec2:*"],
        missing_permissions: ["iam:CreateRole"],
        message: "Missing permissions",
        is_warning: false,
      };

      act(() => {
        result.current.setPermissionCheck(permCheck);
      });
      expect(result.current.permissionCheck).toEqual(permCheck);

      // Reset to null (simulates what happens when profile changes)
      act(() => {
        result.current.setPermissionCheck(null);
      });
      expect(result.current.permissionCheck).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // handleSsoLogin
  // ---------------------------------------------------------------------------
  describe("handleSsoLogin", () => {
    it("invokes aws_sso_login and sets loading state", async () => {
      mockInvoke.mockResolvedValueOnce(undefined); // aws_sso_login

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.handleSsoLogin("sso-profile");
      });

      expect(mockInvoke).toHaveBeenCalledWith("aws_sso_login", { profile: "sso-profile" });
    });

    it("sets error on failure (non LOGIN_CANCELLED)", async () => {
      mockInvoke.mockRejectedValueOnce("SSO flow failed");

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.handleSsoLogin("bad-profile");
      });

      expect(result.current.error).toBe("SSO flow failed");
      expect(result.current.loginInProgress).toBe(false);
      expect(result.current.loading).toBe(false);
    });

    it("does not set error when LOGIN_CANCELLED", async () => {
      mockInvoke.mockRejectedValueOnce("LOGIN_CANCELLED");

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.handleSsoLogin("my-profile");
      });

      expect(result.current.error).toBeNull();
      expect(result.current.loginInProgress).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelSsoLogin
  // ---------------------------------------------------------------------------
  describe("cancelSsoLogin", () => {
    it("invokes cancel_cli_login and resets loginInProgress", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.cancelSsoLogin();
      });

      expect(mockInvoke).toHaveBeenCalledWith("cancel_cli_login");
      expect(result.current.loginInProgress).toBe(false);
    });

    it("still resets loginInProgress on cancellation error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("cancel failed"));

      const { result } = renderHook(() => useAwsAuth());

      await act(async () => {
        await result.current.cancelSsoLogin();
      });

      expect(result.current.loginInProgress).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------
  describe("cleanup", () => {
    it("clears SSO polling on cleanup", () => {
      const { result } = renderHook(() => useAwsAuth());

      // Just verify it doesn't throw
      act(() => {
        result.current.cleanup();
      });

      // After cleanup, loginInProgress should be false
      expect(result.current.loginInProgress).toBe(false);
    });
  });
});
