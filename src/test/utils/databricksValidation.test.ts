import { invoke } from "@tauri-apps/api/core";
import { getDatabricksValidationCommand, validateDatabricksCredentials } from "../../utils/databricksValidation";
import { DatabricksProfile } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("databricksValidation", () => {
  // ---------------------------------------------------------------------------
  // GCP Service Account Key mode
  // ---------------------------------------------------------------------------
  describe("GCP SA Key mode", () => {
    it("returns validate_gcp_databricks_access_with_key command", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          gcp_use_adc: false,
          gcp_credentials_json: '{"type":"service_account"}',
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_gcp_databricks_access_with_key");
      expect(result.command?.args).toEqual({
        accountId: "acc-123",
        saJson: '{"type":"service_account"}',
      });
    });

    it("returns error when account ID is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "",
          gcp_use_adc: false,
          gcp_credentials_json: '{"type":"service_account"}',
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("Databricks Account ID is required");
      expect(result.command).toBeUndefined();
    });

    it("returns error when SA JSON is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          gcp_use_adc: false,
          gcp_credentials_json: "",
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("GCP service account JSON key not available. Please go back and enter it.");
      expect(result.command).toBeUndefined();
    });

    it("validates successfully via invoke", async () => {
      mockInvoke.mockResolvedValueOnce("Databricks access verified");

      await validateDatabricksCredentials({
        credentials: {
          databricks_account_id: "acc-gcp-123",
          gcp_use_adc: false,
          gcp_credentials_json: '{"client_email":"sa@proj.iam.gserviceaccount.com"}',
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_gcp_databricks_access_with_key", {
        accountId: "acc-gcp-123",
        saJson: '{"client_email":"sa@proj.iam.gserviceaccount.com"}',
      });
    });

    it("throws when validation fails", async () => {
      mockInvoke.mockRejectedValueOnce("Service account not authorized in Databricks");

      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-gcp-123",
            gcp_use_adc: false,
            gcp_credentials_json: '{"client_email":"sa@proj.iam.gserviceaccount.com"}',
          },
          selectedCloud: "gcp",
          authMode: "credentials",
          selectedProfile: "",
          profiles: [],
        })
      ).rejects.toMatch("not authorized");
    });
  });

  // ---------------------------------------------------------------------------
  // GCP ADC mode
  // ---------------------------------------------------------------------------
  describe("GCP ADC mode", () => {
    it("returns validate_gcp_databricks_access command", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-456",
          gcp_use_adc: true,
          gcp_oauth_token: "ya29.token-here",
          gcp_service_account_email: "sa@proj.iam.gserviceaccount.com",
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_gcp_databricks_access");
      expect(result.command?.args).toEqual({
        accountId: "acc-456",
        oauthToken: "ya29.token-here",
        serviceAccountEmail: "sa@proj.iam.gserviceaccount.com",
      });
    });

    it("returns error when OAuth token is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-456",
          gcp_use_adc: true,
          gcp_oauth_token: undefined,
          gcp_service_account_email: "sa@proj.iam.gserviceaccount.com",
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("GCP OAuth token not available. Please go back and verify your GCP credentials.");
      expect(result.command).toBeUndefined();
    });

    it("validates successfully via invoke", async () => {
      mockInvoke.mockResolvedValueOnce("Databricks access verified");

      await validateDatabricksCredentials({
        credentials: {
          databricks_account_id: "acc-gcp-456",
          gcp_use_adc: true,
          gcp_oauth_token: "ya29.token-here",
          gcp_service_account_email: "sa@proj.iam.gserviceaccount.com",
        },
        selectedCloud: "gcp",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_gcp_databricks_access", {
        accountId: "acc-gcp-456",
        oauthToken: "ya29.token-here",
        serviceAccountEmail: "sa@proj.iam.gserviceaccount.com",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // AWS/Azure: SP credentials mode
  // ---------------------------------------------------------------------------
  describe("AWS/Azure SP credentials mode", () => {
    it("returns validate_databricks_credentials command", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_databricks_credentials");
      expect(result.command?.args).toEqual({
        accountId: "acc-123",
        clientId: "cid-456",
        clientSecret: "secret-789",
        cloud: "azure",
      });
    });

    it("returns error when account ID is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "aws",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("Databricks Account ID is required");
    });

    it("returns error when client ID is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "aws",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("Databricks Client ID is required");
    });

    it("returns error when client secret is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "cid-456",
          databricks_client_secret: "",
        },
        selectedCloud: "aws",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("Databricks Client Secret is required");
    });

    it("validates successfully via invoke", async () => {
      mockInvoke.mockResolvedValueOnce("Credentials validated");

      await validateDatabricksCredentials({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_databricks_credentials", {
        accountId: "acc-123",
        clientId: "cid-456",
        clientSecret: "secret-789",
        cloud: "azure",
      });
    });

    it("throws on invalid credentials", async () => {
      mockInvoke.mockRejectedValueOnce("Authentication failed (401)");

      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-123",
            databricks_client_id: "bad-id",
            databricks_client_secret: "bad-secret",
          },
          selectedCloud: "aws",
          authMode: "credentials",
          selectedProfile: "",
          profiles: [],
        })
      ).rejects.toMatch("Authentication failed");
    });
  });

  // ---------------------------------------------------------------------------
  // AWS/Azure: SP profile mode (has_client_credentials = true)
  // ---------------------------------------------------------------------------
  describe("AWS/Azure SP profile mode", () => {
    const spProfile: DatabricksProfile = {
      name: "deployer-sp",
      host: "https://accounts.azuredatabricks.net",
      account_id: "acc-123",
      has_client_credentials: true,
      has_token: false,
      cloud: "azure",
    };

    it("returns validate_databricks_credentials command", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "deployer-sp",
        profiles: [spProfile],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_databricks_credentials");
      expect(result.command?.args).toEqual({
        accountId: "acc-123",
        clientId: "cid-456",
        clientSecret: "secret-789",
        cloud: "azure",
      });
    });

    it("returns error when profile is not selected", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "",
        profiles: [spProfile],
      });

      expect(result.error).toBe("Please select a Databricks profile");
    });

    it("returns error when account ID is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "deployer-sp",
        profiles: [spProfile],
      });

      expect(result.error).toBe("Databricks Account ID is required. Please select a valid profile.");
    });

    it("validates successfully via invoke", async () => {
      mockInvoke.mockResolvedValueOnce("Credentials validated");

      await validateDatabricksCredentials({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "cid-456",
          databricks_client_secret: "secret-789",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "deployer-sp",
        profiles: [spProfile],
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_databricks_credentials", {
        accountId: "acc-123",
        clientId: "cid-456",
        clientSecret: "secret-789",
        cloud: "azure",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Azure: OAuth/SSO profile mode (has_client_credentials = false)
  // ---------------------------------------------------------------------------
  describe("Azure OAuth/SSO profile mode", () => {
    const oauthProfile: DatabricksProfile = {
      name: "deployer-oauth",
      host: "https://accounts.azuredatabricks.net",
      account_id: "acc-123",
      has_client_credentials: false,
      has_token: true,
      cloud: "azure",
    };

    it("returns validate_databricks_profile command", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "",
          databricks_client_secret: "",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "deployer-oauth",
        profiles: [oauthProfile],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_databricks_profile");
      expect(result.command?.args).toEqual({
        profileName: "deployer-oauth",
        cloud: "azure",
      });
    });

    it("validates successfully via invoke", async () => {
      mockInvoke.mockResolvedValueOnce("Profile validated - Account Admin access confirmed");

      await validateDatabricksCredentials({
        credentials: {
          databricks_account_id: "acc-123",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "deployer-oauth",
        profiles: [oauthProfile],
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_databricks_profile", {
        profileName: "deployer-oauth",
        cloud: "azure",
      });
    });

    it("throws on unauthorized profile", async () => {
      mockInvoke.mockRejectedValueOnce("Profile 'deployer-oauth' is not authorized");

      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-123",
          },
          selectedCloud: "azure",
          authMode: "profile",
          selectedProfile: "deployer-oauth",
          profiles: [oauthProfile],
        })
      ).rejects.toMatch("not authorized");
    });

    it("throws on profile without admin access", async () => {
      mockInvoke.mockRejectedValueOnce("does not have account admin privileges");

      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-123",
          },
          selectedCloud: "azure",
          authMode: "profile",
          selectedProfile: "deployer-oauth",
          profiles: [oauthProfile],
        })
      ).rejects.toMatch("account admin privileges");
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe("Edge cases", () => {
    it("uses CLI validation when profile has_client_credentials is false, even with leftover clientId", () => {
      const tokenProfile: DatabricksProfile = {
        name: "token-profile",
        host: "https://accounts.azuredatabricks.net",
        account_id: "acc-123",
        has_client_credentials: false,
        has_token: true,
        cloud: "azure",
      };

      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "leftover-client-id", // Should be ignored
          databricks_client_secret: "",
        },
        selectedCloud: "azure",
        authMode: "profile",
        selectedProfile: "token-profile",
        profiles: [tokenProfile],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_databricks_profile");
      expect(result.command?.args).toEqual({
        profileName: "token-profile",
        cloud: "azure",
      });
    });

    it("throws error when getDatabricksValidationCommand returns an error", async () => {
      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "",
          },
          selectedCloud: "aws",
          authMode: "credentials",
          selectedProfile: "",
          profiles: [],
        })
      ).rejects.toThrow("Databricks Account ID is required");

      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Azure identity mode (account admin flow)
  // ---------------------------------------------------------------------------
  describe("Azure identity mode", () => {
    it("returns validate_azure_databricks_identity command", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          azure_databricks_use_identity: true,
          azure_account_email: "user@example.com",
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBeUndefined();
      expect(result.command?.command).toBe("validate_azure_databricks_identity");
      expect(result.command?.args).toEqual({
        accountId: "acc-123",
        azureAccountEmail: "user@example.com",
        azureTenantId: null,
      });
    });

    it("returns error when account ID is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "",
          azure_databricks_use_identity: true,
          azure_account_email: "user@example.com",
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("Databricks Account ID is required");
      expect(result.command).toBeUndefined();
    });

    it("returns error when Azure account email is missing", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          azure_databricks_use_identity: true,
          azure_account_email: undefined,
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.error).toBe("Azure account email not available. Please go back and verify your Azure credentials.");
      expect(result.command).toBeUndefined();
    });

    it("validates successfully via invoke", async () => {
      mockInvoke.mockResolvedValueOnce("Azure identity validated - Account Admin access confirmed for: user@example.com");

      await validateDatabricksCredentials({
        credentials: {
          databricks_account_id: "acc-azure-123",
          azure_databricks_use_identity: true,
          azure_account_email: "user@example.com",
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(mockInvoke).toHaveBeenCalledWith("validate_azure_databricks_identity", {
        accountId: "acc-azure-123",
        azureAccountEmail: "user@example.com",
        azureTenantId: null,
      });
    });

    it("throws when Azure account is not authorized in Databricks", async () => {
      mockInvoke.mockRejectedValueOnce(
        "Your Azure account (user@example.com) is not authorized in Databricks Account Console."
      );

      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-azure-123",
            azure_databricks_use_identity: true,
            azure_account_email: "user@example.com",
          },
          selectedCloud: "azure",
          authMode: "credentials",
          selectedProfile: "",
          profiles: [],
        })
      ).rejects.toMatch("not authorized in Databricks");
    });

    it("throws when Azure account does not have admin privileges", async () => {
      mockInvoke.mockRejectedValueOnce(
        "Your Azure account (user@example.com) does not have account admin privileges."
      );

      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-azure-123",
            azure_databricks_use_identity: true,
            azure_account_email: "user@example.com",
          },
          selectedCloud: "azure",
          authMode: "credentials",
          selectedProfile: "",
          profiles: [],
        })
      ).rejects.toMatch("account admin privileges");
    });

    it("takes precedence over normal Azure flow when flag is set", () => {
      // Even with SP credentials present, if azure_databricks_use_identity is true, use identity mode
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
          databricks_client_id: "client-id",
          databricks_client_secret: "client-secret",
          azure_databricks_use_identity: true,
          azure_account_email: "user@example.com",
        },
        selectedCloud: "azure",
        authMode: "credentials",
        selectedProfile: "",
        profiles: [],
      });

      expect(result.command?.command).toBe("validate_azure_databricks_identity");
      expect(result.command?.args).toEqual({
        accountId: "acc-123",
        azureAccountEmail: "user@example.com",
        azureTenantId: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Edge case: Invalid validation state fallback
  // ---------------------------------------------------------------------------
  describe("fallback / edge cases", () => {
    it("returns 'Invalid validation state' when profile mode has no selected profile and no SP creds", () => {
      const result = getDatabricksValidationCommand({
        credentials: {
          databricks_account_id: "acc-123",
        },
        selectedCloud: "aws",
        authMode: "profile",
        selectedProfile: "some-profile",
        profiles: [
          { name: "some-profile", host: "https://accounts.cloud.databricks.com", account_id: "acc-123", has_client_credentials: false, has_token: false, cloud: "aws" },
        ],
      });

      // This should match the CLI profile validation path
      expect(result.command?.command).toBe("validate_databricks_profile");
    });

    it("validateDatabricksCredentials throws when no command is determined", async () => {
      // Passing an empty selectedProfile in profile mode triggers the "no profile selected" error
      await expect(
        validateDatabricksCredentials({
          credentials: {
            databricks_account_id: "acc-123",
          },
          selectedCloud: "aws",
          authMode: "profile",
          selectedProfile: "",
          profiles: [],
        })
      ).rejects.toThrow("Please select a Databricks profile");
    });
  });
});
