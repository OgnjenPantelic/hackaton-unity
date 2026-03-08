import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAzureAuth } from "../../hooks/useAzureAuth";
import { AzureSubscription, CloudCredentials } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("useAzureAuth", () => {
  // ---------------------------------------------------------------------------
  // loadAccount
  // ---------------------------------------------------------------------------
  describe("loadAccount", () => {
    it("sets account on success", async () => {
      const account = {
        user: "test@azure.com",
        tenant_id: "t-123",
        subscription_id: "s-123",
        subscription_name: "Dev",
      };
      mockInvoke.mockResolvedValueOnce(account);

      const { result } = renderHook(() => useAzureAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.loadAccount();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_azure_account");
      expect(result.current.account).toEqual(account);
      expect(returned).toEqual(account);
    });

    it("sets account to null on error and returns null", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("not logged in"));

      const { result } = renderHook(() => useAzureAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.loadAccount();
      });

      expect(result.current.account).toBeNull();
      expect(returned).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // loadSubscriptions
  // ---------------------------------------------------------------------------
  describe("loadSubscriptions", () => {
    it("sets subscriptions on success", async () => {
      const subs: AzureSubscription[] = [
        { id: "s-1", name: "Sub 1", is_default: true, tenant_id: "t-1" },
      ];
      mockInvoke.mockResolvedValueOnce(subs);

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.loadSubscriptions();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_azure_subscriptions");
      expect(result.current.subscriptions).toEqual(subs);
    });

    it("sets subscriptions to empty array on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.loadSubscriptions();
      });

      expect(result.current.subscriptions).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // loadResourceGroups
  // ---------------------------------------------------------------------------
  describe("loadResourceGroups", () => {
    it("loads resource groups and sets cache key", async () => {
      const groups = [{ name: "rg-1", location: "eastus" }];
      mockInvoke.mockResolvedValueOnce(groups);

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.loadResourceGroups("sub-123");
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_azure_resource_groups", {
        subscriptionId: "sub-123",
      });
      expect(result.current.resourceGroups).toEqual(groups);
    });

    it("skips invoke on cache hit for same subscription", async () => {
      const groups = [{ name: "rg-1", location: "eastus" }];
      mockInvoke.mockResolvedValueOnce(groups);

      const { result } = renderHook(() => useAzureAuth());

      // First call
      await act(async () => {
        await result.current.loadResourceGroups("sub-123");
      });
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      // Second call with same subscription — should skip
      await act(async () => {
        await result.current.loadResourceGroups("sub-123");
      });
      expect(mockInvoke).toHaveBeenCalledTimes(1); // still 1
    });
  });

  // ---------------------------------------------------------------------------
  // handleAzureLogin
  // ---------------------------------------------------------------------------
  describe("handleAzureLogin", () => {
    it("logs in, loads account, and loads subscriptions on success", async () => {
      const account = {
        user: "test@azure.com",
        tenant_id: "t-1",
        subscription_id: "s-1",
        subscription_name: "Dev",
      };
      const subs: AzureSubscription[] = [
        { id: "s-1", name: "Dev", is_default: true, tenant_id: "t-1" },
      ];

      mockInvoke
        .mockResolvedValueOnce(undefined)  // azure_login
        .mockResolvedValueOnce(account)    // get_azure_account
        .mockResolvedValueOnce(subs);      // get_azure_subscriptions

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.handleAzureLogin();
      });

      expect(mockInvoke).toHaveBeenCalledWith("azure_login");
      expect(result.current.account).toEqual(account);
      expect(result.current.subscriptions).toEqual(subs);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce("Login failed");

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.handleAzureLogin();
      });

      expect(result.current.error).toBe("Login failed");
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // handleSubscriptionChange
  // ---------------------------------------------------------------------------
  describe("handleSubscriptionChange", () => {
    it("updates credentials with subscription and tenant ID", async () => {
      // Mock the loadResourceGroups invoke
      mockInvoke.mockResolvedValueOnce([]);

      const setCredentials = vi.fn();
      const subs: AzureSubscription[] = [
        { id: "s-1", name: "Sub 1", is_default: false, tenant_id: "t-1" },
        { id: "s-2", name: "Sub 2", is_default: true, tenant_id: "t-2" },
      ];

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        result.current.handleSubscriptionChange("s-2", subs, setCredentials);
      });

      expect(setCredentials).toHaveBeenCalled();
      const updater = setCredentials.mock.calls[0][0];
      const updated = updater({} as CloudCredentials);
      expect(updated.azure_subscription_id).toBe("s-2");
      expect(updated.azure_tenant_id).toBe("t-2");
    });
  });

  // ---------------------------------------------------------------------------
  // checkPermissions
  // ---------------------------------------------------------------------------
  describe("checkPermissions", () => {
    it("returns permission check on success", async () => {
      const check = {
        has_all_permissions: true,
        checked_permissions: ["Contributor"],
        missing_permissions: [],
        message: "OK",
        is_warning: false,
      };
      mockInvoke.mockResolvedValueOnce(check);

      const { result } = renderHook(() => useAzureAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkPermissions({ cloud: "azure" });
      });

      expect(mockInvoke).toHaveBeenCalledWith("check_azure_permissions", {
        credentials: { cloud: "azure" },
      });
      expect(result.current.permissionCheck).toEqual(check);
      expect(returned).toEqual(check);
      expect(result.current.checkingPermissions).toBe(false);
    });

    it("returns fallback with has_all_permissions true on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useAzureAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkPermissions({ cloud: "azure" });
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

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.handleAzureLogin();
      });
      expect(result.current.error).not.toBeNull();

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
      const { result } = renderHook(() => useAzureAuth());

      const permCheck = {
        has_all_permissions: false,
        checked_permissions: ["Contributor"],
        missing_permissions: ["Network Contributor"],
        message: "Missing permissions",
        is_warning: false,
      };

      act(() => {
        result.current.setPermissionCheck(permCheck);
      });

      expect(result.current.permissionCheck).toEqual(permCheck);
    });

    it("can reset permission check to null", () => {
      const { result } = renderHook(() => useAzureAuth());

      const permCheck = {
        has_all_permissions: false,
        checked_permissions: ["Contributor"],
        missing_permissions: ["Network Contributor"],
        message: "Missing permissions",
        is_warning: false,
      };

      act(() => {
        result.current.setPermissionCheck(permCheck);
      });
      expect(result.current.permissionCheck).toEqual(permCheck);

      // Reset to null (simulates what happens when subscription changes)
      act(() => {
        result.current.setPermissionCheck(null);
      });
      expect(result.current.permissionCheck).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // loadVnets
  // ---------------------------------------------------------------------------
  describe("loadVnets", () => {
    it("loads VNets via CLI mode on success", async () => {
      const vnets = [
        { name: "vnet-1", resource_group: "rg-1", cidr: "10.0.0.0/16" },
      ];
      mockInvoke.mockResolvedValueOnce(vnets);

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.loadVnets();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_azure_vnets");
      expect(result.current.vnets).toEqual(vnets);
    });

    it("loads VNets via service principal mode when credentials provided", async () => {
      const vnets = [
        { name: "vnet-sp", resource_group: "rg-sp", cidr: "10.1.0.0/16" },
      ];
      mockInvoke.mockResolvedValueOnce(vnets);

      const { result } = renderHook(() => useAzureAuth());

      // Switch to SP mode
      act(() => {
        result.current.setAuthMode("service_principal");
      });

      const spCreds: CloudCredentials = {
        azure_client_id: "cid",
        azure_client_secret: "csec",
      };

      await act(async () => {
        await result.current.loadVnets(spCreds);
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_azure_vnets_sp", { credentials: spCreds });
      expect(result.current.vnets).toEqual(vnets);
    });

    it("sets vnets to empty array on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.loadVnets();
      });

      expect(result.current.vnets).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelLogin
  // ---------------------------------------------------------------------------
  describe("cancelLogin", () => {
    it("invokes cancel_cli_login and resets loginInProgress", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.cancelLogin();
      });

      expect(mockInvoke).toHaveBeenCalledWith("cancel_cli_login");
      expect(result.current.loginInProgress).toBe(false);
    });

    it("resets loginInProgress even on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("cancel failed"));

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.cancelLogin();
      });

      expect(result.current.loginInProgress).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // handleAzureLogin: LOGIN_CANCELLED
  // ---------------------------------------------------------------------------
  describe("handleAzureLogin - LOGIN_CANCELLED", () => {
    it("does not set error when login is cancelled", async () => {
      mockInvoke.mockRejectedValueOnce("LOGIN_CANCELLED");

      const { result } = renderHook(() => useAzureAuth());

      await act(async () => {
        await result.current.handleAzureLogin();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });
});
