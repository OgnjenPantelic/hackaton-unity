import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHub } from "../../hooks/useGitHub";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGitHub", () => {
  // ---------------------------------------------------------------------------
  // initial state
  // ---------------------------------------------------------------------------
  it("has correct initial state", () => {
    const { result } = renderHook(() => useGitHub());

    expect(result.current.gitStatus).toBeNull();
    expect(result.current.gitStep).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.remoteUrl).toBe("");
    expect(result.current.loading).toBe(false);
    expect(result.current.previewEntries).toBeNull();
    expect(result.current.authStatus).toBeNull();
    expect(result.current.deviceCode).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // refreshStatus
  // ---------------------------------------------------------------------------
  describe("refreshStatus", () => {
    it("sets git status on success", async () => {
      const status = {
        initialized: true,
        has_commits: true,
        has_remote: true,
        remote_url: "https://github.com/test/repo.git",
        branch: "main",
        files_count: 5,
      };
      mockInvoke.mockResolvedValueOnce(status);

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.refreshStatus("my-deploy");
      });

      expect(mockInvoke).toHaveBeenCalledWith("git_get_status", { deploymentName: "my-deploy" });
      expect(result.current.gitStatus).toEqual(status);
      expect(result.current.remoteUrl).toBe("https://github.com/test/repo.git");
    });

    it("does not set remote URL when status has no remote", async () => {
      const status = {
        initialized: true,
        has_commits: false,
        has_remote: false,
        remote_url: null,
        branch: null,
        files_count: 0,
      };
      mockInvoke.mockResolvedValueOnce(status);

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.refreshStatus("my-deploy");
      });

      expect(result.current.gitStatus).toEqual(status);
      expect(result.current.remoteUrl).toBe("");
    });

    it("silently handles errors", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.refreshStatus("my-deploy");
      });

      expect(result.current.gitStatus).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // loadPreview
  // ---------------------------------------------------------------------------
  describe("loadPreview", () => {
    it("sets preview entries on success and returns true", async () => {
      const entries = [
        { key: "region", value: "us-east-1", has_value: true },
        { key: "name", value: null, has_value: false },
      ];
      mockInvoke.mockResolvedValueOnce(entries);

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = false;
      await act(async () => {
        returned = await result.current.loadPreview("my-deploy");
      });

      expect(mockInvoke).toHaveBeenCalledWith("preview_tfvars_example", { deploymentName: "my-deploy" });
      expect(result.current.previewEntries).toEqual(entries);
      expect(result.current.gitStep).toBe("idle");
      expect(returned).toBe(true);
    });

    it("sets error and returns false on failure", async () => {
      mockInvoke.mockRejectedValueOnce("Preview failed");

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = true;
      await act(async () => {
        returned = await result.current.loadPreview("my-deploy");
      });

      expect(result.current.error).toBe("Preview failed");
      expect(result.current.gitStep).toBe("idle");
      expect(returned).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // initRepo
  // ---------------------------------------------------------------------------
  describe("initRepo", () => {
    it("initializes repo, refreshes status, and returns true on success", async () => {
      const initResult = { success: true, message: "OK" };
      const statusAfter = {
        initialized: true,
        has_commits: true,
        has_remote: false,
        remote_url: null,
        branch: "main",
        files_count: 3,
      };
      mockInvoke
        .mockResolvedValueOnce(initResult)   // git_init_repo
        .mockResolvedValueOnce(statusAfter); // git_get_status

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = false;
      await act(async () => {
        returned = await result.current.initRepo("my-deploy", true);
      });

      expect(mockInvoke).toHaveBeenCalledWith("git_init_repo", {
        deploymentName: "my-deploy",
        includeValues: true,
      });
      expect(result.current.gitStatus).toEqual(statusAfter);
      expect(result.current.previewEntries).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.gitStep).toBe("idle");
      expect(returned).toBe(true);
    });

    it("sets error and returns false when init result is not successful", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, message: "Git not found" });

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = true;
      await act(async () => {
        returned = await result.current.initRepo("my-deploy", false);
      });

      expect(result.current.error).toBe("Git not found");
      expect(result.current.loading).toBe(false);
      expect(returned).toBe(false);
    });

    it("sets error and returns false on invoke error", async () => {
      mockInvoke.mockRejectedValueOnce("Unexpected error");

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = true;
      await act(async () => {
        returned = await result.current.initRepo("my-deploy", false);
      });

      expect(result.current.error).toBe("Unexpected error");
      expect(returned).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // checkRemote
  // ---------------------------------------------------------------------------
  describe("checkRemote", () => {
    it("returns success result and clears error", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, message: "OK" });

      const { result } = renderHook(() => useGitHub());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkRemote("my-deploy", "https://github.com/test/repo.git");
      });

      expect(mockInvoke).toHaveBeenCalledWith("git_check_remote", {
        deploymentName: "my-deploy",
        remoteUrl: "https://github.com/test/repo.git",
      });
      expect(returned).toEqual({ success: true, message: "OK" });
      expect(result.current.error).toBeNull();
    });

    it("sets error when remote check fails", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, message: "Remote not accessible" });

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.checkRemote("my-deploy", "https://bad-url.git");
      });

      expect(result.current.error).toBe("Remote not accessible");
    });

    it("returns failure result on invoke error", async () => {
      mockInvoke.mockRejectedValueOnce("Network error");

      const { result } = renderHook(() => useGitHub());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.checkRemote("my-deploy", "url");
      });

      expect(returned).toEqual({ success: false, message: "Network error" });
      expect(result.current.error).toBe("Network error");
    });
  });

  // ---------------------------------------------------------------------------
  // pushToRemote
  // ---------------------------------------------------------------------------
  describe("pushToRemote", () => {
    it("pushes, refreshes status, and returns true on success", async () => {
      const pushResult = { success: true, message: "Pushed" };
      const statusAfter = {
        initialized: true,
        has_commits: true,
        has_remote: true,
        remote_url: "https://github.com/test/repo.git",
        branch: "main",
        files_count: 3,
      };
      mockInvoke
        .mockResolvedValueOnce(pushResult)   // git_push_to_remote
        .mockResolvedValueOnce(statusAfter); // git_get_status

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = false;
      await act(async () => {
        returned = await result.current.pushToRemote("my-deploy", "https://github.com/test/repo.git");
      });

      expect(result.current.gitStatus).toEqual(statusAfter);
      expect(result.current.loading).toBe(false);
      expect(returned).toBe(true);
    });

    it("sets error and returns false on push failure", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, message: "Auth required" });

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = true;
      await act(async () => {
        returned = await result.current.pushToRemote("my-deploy", "url");
      });

      expect(result.current.error).toBe("Auth required");
      expect(returned).toBe(false);
    });

    it("sets error and returns false on invoke error", async () => {
      mockInvoke.mockRejectedValueOnce("Network timeout");

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = true;
      await act(async () => {
        returned = await result.current.pushToRemote("my-deploy", "url");
      });

      expect(result.current.error).toBe("Network timeout");
      expect(returned).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // checkAuth
  // ---------------------------------------------------------------------------
  describe("checkAuth", () => {
    it("sets authStatus on success", async () => {
      const auth = { authenticated: true, username: "testuser", avatar_url: "https://avatar" };
      mockInvoke.mockResolvedValueOnce(auth);

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(mockInvoke).toHaveBeenCalledWith("github_get_auth");
      expect(result.current.authStatus).toEqual(auth);
    });

    it("sets unauthenticated fallback on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(result.current.authStatus).toEqual({
        authenticated: false,
        username: null,
        avatar_url: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // cancelDeviceAuth
  // ---------------------------------------------------------------------------
  describe("cancelDeviceAuth", () => {
    it("clears device code and resets step to idle", () => {
      const { result } = renderHook(() => useGitHub());

      act(() => {
        result.current.cancelDeviceAuth();
      });

      expect(result.current.deviceCode).toBeNull();
      expect(result.current.gitStep).toBe("idle");
    });
  });

  // ---------------------------------------------------------------------------
  // startDeviceAuth
  // ---------------------------------------------------------------------------
  describe("startDeviceAuth", () => {
    it("sets device code and starts polling on success", async () => {
      const code = {
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        device_code: "dev-code-123",
        interval: 5,
        expires_in: 900,
      };
      mockInvoke.mockResolvedValueOnce(code);

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = false;
      await act(async () => {
        returned = await result.current.startDeviceAuth();
      });

      expect(mockInvoke).toHaveBeenCalledWith("github_device_auth_start");
      expect(result.current.deviceCode).toEqual(code);
      expect(returned).toBe(true);
    });

    it("sets error and returns false on failure", async () => {
      mockInvoke.mockRejectedValueOnce("GitHub API error");

      const { result } = renderHook(() => useGitHub());

      let returned: boolean = true;
      await act(async () => {
        returned = await result.current.startDeviceAuth();
      });

      expect(result.current.error).toBe("GitHub API error");
      expect(result.current.gitStep).toBe("idle");
      expect(returned).toBe(false);
    });

    it("completes auth on success poll", async () => {
      const code = {
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        device_code: "dev-code-123",
        interval: 5,
        expires_in: 900,
      };
      mockInvoke.mockResolvedValueOnce(code);

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.startDeviceAuth();
      });

      // Set up success poll response
      mockInvoke.mockResolvedValueOnce({
        status: "success",
        username: "octocat",
        avatar_url: "https://avatar.url",
      });

      // Advance timer to trigger poll
      await act(async () => {
        vi.advanceTimersByTime(5000);
        // Allow the async poll function to resolve
        await vi.runAllTimersAsync();
      });

      expect(result.current.authStatus).toEqual({
        authenticated: true,
        username: "octocat",
        avatar_url: "https://avatar.url",
      });
      expect(result.current.deviceCode).toBeNull();
      expect(result.current.gitStep).toBe("idle");
    });

    it("sets error on expired poll", async () => {
      const code = {
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        device_code: "dev-code-123",
        interval: 5,
        expires_in: 900,
      };
      mockInvoke.mockResolvedValueOnce(code);

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.startDeviceAuth();
      });

      mockInvoke.mockResolvedValueOnce({ status: "expired" });

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await vi.runAllTimersAsync();
      });

      expect(result.current.error).toBe("Authorization timed out. Try again.");
      expect(result.current.deviceCode).toBeNull();
      expect(result.current.gitStep).toBe("idle");
    });

    it("sets error on denied poll", async () => {
      const code = {
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        device_code: "dev-code-123",
        interval: 5,
        expires_in: 900,
      };
      mockInvoke.mockResolvedValueOnce(code);

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.startDeviceAuth();
      });

      mockInvoke.mockResolvedValueOnce({ status: "denied" });

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await vi.runAllTimersAsync();
      });

      expect(result.current.error).toBe("Authorization was denied. Try again if this was a mistake.");
      expect(result.current.deviceCode).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------------------
  describe("logout", () => {
    it("clears auth status on success", async () => {
      // First, set authenticated state
      mockInvoke.mockResolvedValueOnce({ authenticated: true, username: "user", avatar_url: null });
      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.checkAuth();
      });
      expect(result.current.authStatus?.authenticated).toBe(true);

      // Then logout
      mockInvoke.mockResolvedValueOnce(undefined);
      await act(async () => {
        await result.current.logout();
      });

      expect(mockInvoke).toHaveBeenCalledWith("github_logout");
      expect(result.current.authStatus).toEqual({
        authenticated: false,
        username: null,
        avatar_url: null,
      });
    });

    it("sets error on logout failure", async () => {
      mockInvoke.mockRejectedValueOnce("Logout error");

      const { result } = renderHook(() => useGitHub());

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.error).toBe("Logout error");
    });
  });

  // ---------------------------------------------------------------------------
  // createRepo
  // ---------------------------------------------------------------------------
  describe("createRepo", () => {
    it("creates repo, refreshes status, and returns repo on success", async () => {
      const repo = {
        name: "my-repo",
        full_name: "user/my-repo",
        html_url: "https://github.com/user/my-repo",
        clone_url: "https://github.com/user/my-repo.git",
        private: true,
      };
      const statusAfter = {
        initialized: true,
        has_commits: true,
        has_remote: true,
        remote_url: "https://github.com/user/my-repo.git",
        branch: "main",
        files_count: 3,
      };
      mockInvoke
        .mockResolvedValueOnce(repo)         // github_create_repo
        .mockResolvedValueOnce(statusAfter); // git_get_status

      const { result } = renderHook(() => useGitHub());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.createRepo("my-deploy", "my-repo", true, "A repo");
      });

      expect(mockInvoke).toHaveBeenCalledWith("github_create_repo", {
        deploymentName: "my-deploy",
        repoName: "my-repo",
        private: true,
        description: "A repo",
      });
      expect(returned).toEqual(repo);
      expect(result.current.gitStatus).toEqual(statusAfter);
      expect(result.current.loading).toBe(false);
      expect(result.current.gitStep).toBe("idle");
    });

    it("sets error and returns null on failure", async () => {
      mockInvoke.mockRejectedValueOnce("Create failed");

      const { result } = renderHook(() => useGitHub());

      let returned: unknown;
      await act(async () => {
        returned = await result.current.createRepo("my-deploy", "repo", false, "");
      });

      expect(result.current.error).toBe("Create failed");
      expect(returned).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // setters
  // ---------------------------------------------------------------------------
  describe("setters", () => {
    it("setRemoteUrl updates remoteUrl", () => {
      const { result } = renderHook(() => useGitHub());

      act(() => {
        result.current.setRemoteUrl("https://github.com/new/url.git");
      });

      expect(result.current.remoteUrl).toBe("https://github.com/new/url.git");
    });

    it("setError updates error", () => {
      const { result } = renderHook(() => useGitHub());

      act(() => {
        result.current.setError("custom error");
      });

      expect(result.current.error).toBe("custom error");

      act(() => {
        result.current.setError(null);
      });

      expect(result.current.error).toBeNull();
    });
  });
});
