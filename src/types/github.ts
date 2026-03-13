export interface GitRepoStatus {
  initialized: boolean;
  has_remote: boolean;
  remote_url: string | null;
  branch: string | null;
  commit_count: number;
}

export interface GitOperationResult {
  success: boolean;
  message: string;
}

export interface TfVarPreviewEntry {
  name: string;
  value: string;
  is_sensitive: boolean;
  placeholder: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceAuthPollResult {
  status: "pending" | "slow_down" | "expired" | "denied" | "success";
  access_token: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface GitHubAuthStatus {
  authenticated: boolean;
  username: string | null;
  avatar_url: string | null;
}

export interface GitHubRepo {
  clone_url: string;
  html_url: string;
}
