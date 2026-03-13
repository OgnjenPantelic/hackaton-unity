import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  GitRepoStatus,
  GitOperationResult,
  TfVarPreviewEntry,
  DeviceCodeResponse,
  DeviceAuthPollResult,
  GitHubAuthStatus,
  GitHubRepo,
} from "../types";

export type GitStep =
  | "idle"
  | "previewing"
  | "initializing"
  | "checking-remote"
  | "pushing"
  | "authenticating"
  | "creating-repo";

export interface UseGitHubReturn {
  gitStatus: GitRepoStatus | null;
  gitStep: GitStep;
  error: string | null;
  remoteUrl: string;
  loading: boolean;

  // Tfvars preview
  previewEntries: TfVarPreviewEntry[] | null;

  // OAuth
  authStatus: GitHubAuthStatus | null;
  deviceCode: DeviceCodeResponse | null;

  // Actions
  setRemoteUrl: (url: string) => void;
  setError: (error: string | null) => void;
  refreshStatus: (deploymentName: string) => Promise<void>;
  loadPreview: (deploymentName: string) => Promise<boolean>;
  initRepo: (deploymentName: string, includeValues: boolean) => Promise<boolean>;
  checkRemote: (deploymentName: string, url: string) => Promise<GitOperationResult>;
  pushToRemote: (deploymentName: string, url: string) => Promise<boolean>;
  checkAuth: () => Promise<void>;
  startDeviceAuth: () => Promise<boolean>;
  cancelDeviceAuth: () => void;
  logout: () => Promise<void>;
  createRepo: (
    deploymentName: string,
    repoName: string,
    isPrivate: boolean,
    description: string,
  ) => Promise<GitHubRepo | null>;
}

export function useGitHub(): UseGitHubReturn {
  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  const [gitStep, setGitStep] = useState<GitStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [previewEntries, setPreviewEntries] = useState<TfVarPreviewEntry[] | null>(null);
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const refreshStatus = useCallback(async (deploymentName: string) => {
    try {
      const status = await invoke<GitRepoStatus>("git_get_status", { deploymentName });
      setGitStatus(status);
      if (status.remote_url) setRemoteUrl(status.remote_url);
    } catch {
      // Not critical
    }
  }, []);

  const loadPreview = useCallback(async (deploymentName: string): Promise<boolean> => {
    setError(null);
    setGitStep("previewing");
    try {
      const entries = await invoke<TfVarPreviewEntry[]>("preview_tfvars_example", {
        deploymentName,
      });
      if (isMountedRef.current) setPreviewEntries(entries);
      setGitStep("idle");
      return true;
    } catch (e: unknown) {
      if (isMountedRef.current) {
        setError(String(e));
        setGitStep("idle");
      }
      return false;
    }
  }, []);

  const initRepo = useCallback(
    async (deploymentName: string, includeValues: boolean): Promise<boolean> => {
      setError(null);
      setGitStep("initializing");
      setLoading(true);

      try {
        const result = await invoke<GitOperationResult>("git_init_repo", {
          deploymentName,
          includeValues,
        });
        if (!result.success) {
          setError(result.message);
          setGitStep("idle");
          setLoading(false);
          return false;
        }

        await invoke<GitRepoStatus>("git_get_status", { deploymentName }).then(setGitStatus);
        setPreviewEntries(null);
        setGitStep("idle");
        setLoading(false);
        return true;
      } catch (e: unknown) {
        setError(String(e));
        setGitStep("idle");
        setLoading(false);
        return false;
      }
    },
    [],
  );

  const checkRemote = useCallback(
    async (deploymentName: string, url: string): Promise<GitOperationResult> => {
      setError(null);
      setGitStep("checking-remote");

      try {
        const result = await invoke<GitOperationResult>("git_check_remote", {
          deploymentName,
          remoteUrl: url,
        });
        if (!result.success) setError(result.message);
        setGitStep("idle");
        return result;
      } catch (e: unknown) {
        const message = String(e);
        setError(message);
        setGitStep("idle");
        return { success: false, message };
      }
    },
    [],
  );

  const pushToRemote = useCallback(
    async (deploymentName: string, url: string): Promise<boolean> => {
      setError(null);
      setGitStep("pushing");
      setLoading(true);

      try {
        const result = await invoke<GitOperationResult>("git_push_to_remote", {
          deploymentName,
          remoteUrl: url,
        });

        if (!result.success) {
          setError(result.message);
          setGitStep("idle");
          setLoading(false);
          return false;
        }

        await invoke<GitRepoStatus>("git_get_status", { deploymentName }).then(setGitStatus);
        setGitStep("idle");
        setLoading(false);
        return true;
      } catch (e: unknown) {
        setError(String(e));
        setGitStep("idle");
        setLoading(false);
        return false;
      }
    },
    [],
  );

  // ─── OAuth ──────────────────────────────────────────────────────────

  const checkAuth = useCallback(async () => {
    try {
      const status = await invoke<GitHubAuthStatus>("github_get_auth");
      if (isMountedRef.current) setAuthStatus(status);
    } catch {
      if (isMountedRef.current)
        setAuthStatus({ authenticated: false, username: null, avatar_url: null });
    }
  }, []);

  const cancelDeviceAuth = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setDeviceCode(null);
    setGitStep("idle");
  }, []);

  const pollIntervalRef = useRef(5000);
  const pollFnRef = useRef<() => void>();

  const schedulePoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollFnRef.current?.(), pollIntervalRef.current);
  }, []);

  const startDeviceAuth = useCallback(async (): Promise<boolean> => {
    setError(null);
    setGitStep("authenticating");

    try {
      const code = await invoke<DeviceCodeResponse>("github_device_auth_start");
      if (!isMountedRef.current) return false;

      setDeviceCode(code);
      pollIntervalRef.current = code.interval * 1000;

      pollFnRef.current = async () => {
        try {
          const result = await invoke<DeviceAuthPollResult>("github_device_auth_poll", {
            deviceCode: code.device_code,
          });

          if (!isMountedRef.current) return;

          if (result.status === "success") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDeviceCode(null);
            setAuthStatus({
              authenticated: true,
              username: result.username,
              avatar_url: result.avatar_url,
            });
            setGitStep("idle");
          } else if (result.status === "slow_down") {
            pollIntervalRef.current += 5000;
            schedulePoll();
          } else if (result.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDeviceCode(null);
            setError("Authorization timed out. Try again.");
            setGitStep("idle");
          } else if (result.status === "denied") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDeviceCode(null);
            setError("Authorization was denied. Try again if this was a mistake.");
            setGitStep("idle");
          }
        } catch (e: unknown) {
          console.error("[useGitHub] Poll error:", e);
        }
      };

      schedulePoll();
      return true;
    } catch (e: unknown) {
      setError(String(e));
      setGitStep("idle");
      return false;
    }
  }, [schedulePoll]);

  const logout = useCallback(async () => {
    try {
      await invoke("github_logout");
      setAuthStatus({ authenticated: false, username: null, avatar_url: null });
    } catch (e: unknown) {
      setError(String(e));
    }
  }, []);

  const createRepo = useCallback(
    async (
      deploymentName: string,
      repoName: string,
      isPrivate: boolean,
      description: string,
    ): Promise<GitHubRepo | null> => {
      setError(null);
      setGitStep("creating-repo");
      setLoading(true);

      try {
        const repo = await invoke<GitHubRepo>("github_create_repo", {
          deploymentName,
          repoName,
          private: isPrivate,
          description,
        });

        await invoke<GitRepoStatus>("git_get_status", { deploymentName }).then(setGitStatus);
        setGitStep("idle");
        setLoading(false);
        return repo;
      } catch (e: unknown) {
        setError(String(e));
        setGitStep("idle");
        setLoading(false);
        return null;
      }
    },
    [],
  );

  return {
    gitStatus,
    gitStep,
    error,
    remoteUrl,
    loading,
    previewEntries,
    authStatus,
    deviceCode,
    setRemoteUrl,
    setError,
    refreshStatus,
    loadPreview,
    initRepo,
    checkRemote,
    pushToRemote,
    checkAuth,
    startDeviceAuth,
    cancelDeviceAuth,
    logout,
    createRepo,
  };
}
