import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabricksAuth } from "../../hooks/useDatabricksAuth";
import { DatabricksProfile, CloudCredentials } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("useDatabricksAuth", () => {
  const sampleProfiles: DatabricksProfile[] = [
    {
      name: "default",
      host: "https://accounts.cloud.databricks.com",
      account_id: "acc-123",
      has_client_credentials: false,
      has_token: true,
      cloud: "aws",
    },
    {
      name: "sp-profile",
      host: "https://accounts.cloud.databricks.com",
      account_id: "acc-456",
      has_client_credentials: true,
      has_token: false,
      cloud: "azure",
    },
  ];

  // ---------------------------------------------------------------------------
  // loadProfiles
  // ---------------------------------------------------------------------------
  describe("loadProfiles", () => {
    it("loads profiles and updates state on success", async () => {
      mockInvoke.mockResolvedValueOnce(sampleProfiles);

      const { result } = renderHook(() => useDatabricksAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.loadProfiles();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_databricks_profiles");
      expect(result.current.profiles).toEqual(sampleProfiles);
      expect(returned).toEqual(sampleProfiles);
    });

    it("returns empty array on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("no config"));

      const { result } = renderHook(() => useDatabricksAuth());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.loadProfiles();
      });

      expect(returned).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // handleProfileChange
  // ---------------------------------------------------------------------------
  describe("handleProfileChange", () => {
    it("updates selectedProfile and credentials with profile data", () => {
      const setCredentials = vi.fn();
      const { result } = renderHook(() => useDatabricksAuth());

      act(() => {
        result.current.handleProfileChange("default", sampleProfiles, setCredentials);
      });

      expect(result.current.selectedProfile).toBe("default");
      expect(setCredentials).toHaveBeenCalled();

      const updater = setCredentials.mock.calls[0][0];
      const updated = updater({ cloud: "aws" } as CloudCredentials);
      expect(updated.databricks_profile).toBe("default");
      expect(updated.databricks_account_id).toBe("acc-123");
      expect(updated.databricks_auth_type).toBe("profile");
    });

    it("does not update credentials for a non-existent profile", () => {
      const setCredentials = vi.fn();
      const { result } = renderHook(() => useDatabricksAuth());

      act(() => {
        result.current.handleProfileChange("nonexistent", sampleProfiles, setCredentials);
      });

      expect(result.current.selectedProfile).toBe("nonexistent");
      expect(setCredentials).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // handleAddSpProfile
  // ---------------------------------------------------------------------------
  describe("handleAddSpProfile", () => {
    it("adds SP profile and updates state on success", async () => {
      const newProfile: DatabricksProfile = {
        name: "new-sp",
        host: "https://accounts.cloud.databricks.com",
        account_id: "acc-789",
        has_client_credentials: true,
        has_token: false,
        cloud: "aws",
      };

      mockInvoke
        .mockResolvedValueOnce(undefined)                 // add_databricks_sp_profile
        .mockResolvedValueOnce([...sampleProfiles, newProfile]); // get_databricks_profiles (reload)

      const setCredentials = vi.fn();
      const { result } = renderHook(() => useDatabricksAuth());

      await act(async () => {
        await result.current.handleAddSpProfile(
          "new-sp",
          { accountId: "acc-789", clientId: "cid", clientSecret: "csec" },
          setCredentials
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("add_databricks_sp_profile", {
        profileName: "new-sp",
        accountId: "acc-789",
        clientId: "cid",
        clientSecret: "csec",
      });

      expect(result.current.selectedProfile).toBe("new-sp");
      expect(result.current.authMode).toBe("profile");
      expect(result.current.showAddSpProfileForm).toBe(false);
      expect(result.current.loading).toBe(false);
      expect(setCredentials).toHaveBeenCalled();
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce("Failed to add profile");

      const setCredentials = vi.fn();
      const { result } = renderHook(() => useDatabricksAuth());

      await act(async () => {
        await result.current.handleAddSpProfile(
          "bad-sp",
          { accountId: "a", clientId: "c", clientSecret: "s" },
          setCredentials
        );
      });

      expect(result.current.error).toBe("Failed to add profile");
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // handleOAuthLogin
  // ---------------------------------------------------------------------------
  describe("handleOAuthLogin", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("initiates OAuth login and finds profile via polling", async () => {
      const oauthProfile: DatabricksProfile = {
        name: "oauth-acc-123",
        host: "https://accounts.cloud.databricks.com",
        account_id: "acc-123",
        has_client_credentials: false,
        has_token: true,
        cloud: "aws",
      };

      mockInvoke
        .mockResolvedValueOnce(undefined)             // databricks_oauth_login
        .mockResolvedValueOnce([])                    // first poll: no matching profile
        .mockResolvedValueOnce([oauthProfile]);       // second poll: found it

      const setCredentials = vi.fn();
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useDatabricksAuth());

      await act(async () => {
        result.current.handleOAuthLogin("acc-123", setCredentials, onSuccess);
      });

      expect(mockInvoke).toHaveBeenCalledWith("databricks_oauth_login", {
        accountId: "acc-123",
      });

      // First poll tick — no match
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Second poll tick — match found
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.selectedProfile).toBe("oauth-acc-123");
      expect(result.current.authMode).toBe("profile");
      expect(result.current.showLoginForm).toBe(false);
      expect(result.current.loading).toBe(false);
      expect(onSuccess).toHaveBeenCalled();
      expect(setCredentials).toHaveBeenCalled();
    });

    it("sets error on OAuth invoke failure", async () => {
      mockInvoke.mockRejectedValueOnce("OAuth failed");

      const setCredentials = vi.fn();
      const { result } = renderHook(() => useDatabricksAuth());

      await act(async () => {
        await result.current.handleOAuthLogin("acc-123", setCredentials);
      });

      expect(result.current.error).toBe("OAuth failed");
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------
  describe("cleanup", () => {
    it("can be called without error", () => {
      const { result } = renderHook(() => useDatabricksAuth());

      act(() => {
        result.current.cleanup();
      });

      // No assertion needed — just verifying it doesn't throw
    });
  });
});
