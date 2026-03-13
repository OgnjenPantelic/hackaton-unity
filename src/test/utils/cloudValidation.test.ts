import { invoke } from "@tauri-apps/api/core";
import { validateAwsCredentials, validateAzureCredentials } from "../../utils/cloudValidation";
import { CloudPermissionCheck, AwsIdentity, AzureAccount } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("cloudValidation", () => {
  // ---------------------------------------------------------------------------
  // AWS validation
  // ---------------------------------------------------------------------------
  describe("validateAwsCredentials", () => {
    const mockIdentity: AwsIdentity = {
      account: "123456789012",
      arn: "arn:aws:iam::123456789012:user/test",
      user_id: "AIDAI123456789",
    };

    describe("profile mode", () => {
      it("blocks when identity is not set", async () => {
        const result = await validateAwsCredentials({
          authMode: "profile",
          identity: null,
          credentials: { cloud: "aws" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Please verify your AWS credentials first");
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it("proceeds when permissions are valid", async () => {
        const permCheck: CloudPermissionCheck = {
          has_all_permissions: true,
          checked_permissions: ["ec2:*", "iam:*"],
          missing_permissions: [],
          message: "All permissions present",
          is_warning: false,
        };
        mockInvoke.mockResolvedValueOnce(permCheck);

        const result = await validateAwsCredentials({
          authMode: "profile",
          identity: mockIdentity,
          credentials: { cloud: "aws", aws_profile: "default" },
        });

        expect(result.proceed).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.permissionWarning).toBeUndefined();
        expect(result.permissionCheck).toEqual(permCheck);
        expect(mockInvoke).toHaveBeenCalledWith("check_aws_permissions", {
          credentials: { cloud: "aws", aws_profile: "default" },
        });
      });

      it("shows permission warning when permissions are missing", async () => {
        const permCheck: CloudPermissionCheck = {
          has_all_permissions: false,
          checked_permissions: ["ec2:*", "iam:*"],
          missing_permissions: ["iam:CreateRole"],
          message: "Missing IAM permissions",
          is_warning: false,
        };
        mockInvoke.mockResolvedValueOnce(permCheck);

        const result = await validateAwsCredentials({
          authMode: "profile",
          identity: mockIdentity,
          credentials: { cloud: "aws", aws_profile: "default" },
        });

        expect(result.proceed).toBe(false);
        expect(result.permissionWarning).toBe(true);
        expect(result.permissionCheck).toEqual(permCheck);
      });

      it("blocks on permission check failure", async () => {
        mockInvoke.mockRejectedValueOnce("InvalidClientTokenId: The security token is invalid");

        const result = await validateAwsCredentials({
          authMode: "profile",
          identity: mockIdentity,
          credentials: { cloud: "aws", aws_profile: "default" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toMatch("InvalidClientTokenId");
        expect(result.permissionWarning).toBeUndefined();
      });
    });

    describe("keys mode", () => {
      it("blocks when access key is missing", async () => {
        const result = await validateAwsCredentials({
          authMode: "keys",
          identity: null,
          credentials: { cloud: "aws", aws_access_key_id: "", aws_secret_access_key: "secret" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("AWS Access Key ID is required");
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it("blocks when secret key is missing", async () => {
        const result = await validateAwsCredentials({
          authMode: "keys",
          identity: null,
          credentials: { cloud: "aws", aws_access_key_id: "AKIA123", aws_secret_access_key: "" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("AWS Secret Access Key is required");
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it("proceeds when keys are valid and permissions pass", async () => {
        const permCheck: CloudPermissionCheck = {
          has_all_permissions: true,
          checked_permissions: ["ec2:*"],
          missing_permissions: [],
          message: "OK",
          is_warning: false,
        };
        mockInvoke.mockResolvedValueOnce(permCheck);

        const result = await validateAwsCredentials({
          authMode: "keys",
          identity: null,
          credentials: {
            cloud: "aws",
            aws_access_key_id: "AKIA123",
            aws_secret_access_key: "secret",
          },
        });

        expect(result.proceed).toBe(true);
        expect(result.permissionCheck).toEqual(permCheck);
      });

      it("blocks on invalid keys", async () => {
        mockInvoke.mockRejectedValueOnce("InvalidAccessKeyId: The AWS Access Key Id you provided does not exist");

        const result = await validateAwsCredentials({
          authMode: "keys",
          identity: null,
          credentials: {
            cloud: "aws",
            aws_access_key_id: "AKIA_BAD",
            aws_secret_access_key: "bad_secret",
          },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toMatch("InvalidAccessKeyId");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Azure validation
  // ---------------------------------------------------------------------------
  describe("validateAzureCredentials", () => {
    const mockAccount: AzureAccount = {
      user: "test@azure.com",
      tenant_id: "tenant-123",
      subscription_id: "sub-123",
      subscription_name: "Dev Subscription",
    };

    describe("CLI mode", () => {
      it("blocks when account is not set", async () => {
        const result = await validateAzureCredentials({
          authMode: "cli",
          account: null,
          credentials: { cloud: "azure" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Please verify your Azure credentials first");
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it("blocks when subscription is not selected", async () => {
        const result = await validateAzureCredentials({
          authMode: "cli",
          account: mockAccount,
          credentials: { cloud: "azure", azure_subscription_id: "" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Please select an Azure subscription");
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it("proceeds when permissions are valid", async () => {
        const permCheck: CloudPermissionCheck = {
          has_all_permissions: true,
          checked_permissions: ["Contributor"],
          missing_permissions: [],
          message: "All permissions present",
          is_warning: false,
        };
        mockInvoke.mockResolvedValueOnce(permCheck);

        const result = await validateAzureCredentials({
          authMode: "cli",
          account: mockAccount,
          credentials: { cloud: "azure", azure_subscription_id: "sub-123" },
        });

        expect(result.proceed).toBe(true);
        expect(result.permissionCheck).toEqual(permCheck);
        expect(mockInvoke).toHaveBeenCalledWith("check_azure_permissions", {
          credentials: { cloud: "azure", azure_subscription_id: "sub-123" },
        });
      });

      it("shows permission warning when permissions are missing", async () => {
        const permCheck: CloudPermissionCheck = {
          has_all_permissions: false,
          checked_permissions: ["Contributor", "Network Contributor"],
          missing_permissions: ["Network Contributor"],
          message: "Missing network permissions",
          is_warning: false,
        };
        mockInvoke.mockResolvedValueOnce(permCheck);

        const result = await validateAzureCredentials({
          authMode: "cli",
          account: mockAccount,
          credentials: { cloud: "azure", azure_subscription_id: "sub-123" },
        });

        expect(result.proceed).toBe(false);
        expect(result.permissionWarning).toBe(true);
        expect(result.permissionCheck).toEqual(permCheck);
      });

      it("blocks on permission check failure", async () => {
        mockInvoke.mockRejectedValueOnce("az login required");

        const result = await validateAzureCredentials({
          authMode: "cli",
          account: mockAccount,
          credentials: { cloud: "azure", azure_subscription_id: "sub-123" },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toMatch("az login required");
      });
    });

    describe("service principal mode", () => {
      it("blocks when tenant ID is missing", async () => {
        const result = await validateAzureCredentials({
          authMode: "service_principal",
          account: null,
          credentials: {
            cloud: "azure",
            azure_tenant_id: "",
            azure_subscription_id: "sub-123",
            azure_client_id: "client-123",
            azure_client_secret: "secret",
          },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Azure Tenant ID is required");
        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it("blocks when subscription ID is missing", async () => {
        const result = await validateAzureCredentials({
          authMode: "service_principal",
          account: null,
          credentials: {
            cloud: "azure",
            azure_tenant_id: "tenant-123",
            azure_subscription_id: "",
            azure_client_id: "client-123",
            azure_client_secret: "secret",
          },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Azure Subscription ID is required");
      });

      it("blocks when client ID is missing", async () => {
        const result = await validateAzureCredentials({
          authMode: "service_principal",
          account: null,
          credentials: {
            cloud: "azure",
            azure_tenant_id: "tenant-123",
            azure_subscription_id: "sub-123",
            azure_client_id: "",
            azure_client_secret: "secret",
          },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Azure Client ID is required");
      });

      it("blocks when client secret is missing", async () => {
        const result = await validateAzureCredentials({
          authMode: "service_principal",
          account: null,
          credentials: {
            cloud: "azure",
            azure_tenant_id: "tenant-123",
            azure_subscription_id: "sub-123",
            azure_client_id: "client-123",
            azure_client_secret: "",
          },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toBe("Azure Client Secret is required");
      });

      it("proceeds when SP credentials are valid", async () => {
        const permCheck: CloudPermissionCheck = {
          has_all_permissions: true,
          checked_permissions: ["Contributor"],
          missing_permissions: [],
          message: "OK",
          is_warning: false,
        };
        mockInvoke.mockResolvedValueOnce(permCheck);

        const result = await validateAzureCredentials({
          authMode: "service_principal",
          account: null,
          credentials: {
            cloud: "azure",
            azure_tenant_id: "tenant-123",
            azure_subscription_id: "sub-123",
            azure_client_id: "client-123",
            azure_client_secret: "secret",
          },
        });

        expect(result.proceed).toBe(true);
        expect(result.permissionCheck).toEqual(permCheck);
      });

      it("blocks on invalid SP credentials", async () => {
        mockInvoke.mockRejectedValueOnce("AADSTS7000215: Invalid client secret provided");

        const result = await validateAzureCredentials({
          authMode: "service_principal",
          account: null,
          credentials: {
            cloud: "azure",
            azure_tenant_id: "tenant-123",
            azure_subscription_id: "sub-123",
            azure_client_id: "client-123",
            azure_client_secret: "bad_secret",
          },
        });

        expect(result.proceed).toBe(false);
        expect(result.error).toMatch("AADSTS7000215");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Edge case coverage for fallback error messages
  // ---------------------------------------------------------------------------
  describe("error fallback branches", () => {
    it("AWS: uses fallback message when error is falsy", async () => {
      mockInvoke.mockRejectedValueOnce("");

      const result = await validateAwsCredentials({
        authMode: "profile",
        identity: { account: "123", arn: "arn", user_id: "U1" },
        credentials: { cloud: "aws", aws_profile: "default" },
      });

      expect(result.proceed).toBe(false);
      expect(result.error).toBe("Credential validation failed");
    });

    it("Azure: uses fallback message when error is falsy", async () => {
      mockInvoke.mockRejectedValueOnce("");

      const result = await validateAzureCredentials({
        authMode: "cli",
        account: { user: "u", tenant_id: "t", subscription_id: "s", subscription_name: "n" },
        credentials: { cloud: "azure", azure_subscription_id: "s" },
      });

      expect(result.proceed).toBe(false);
      expect(result.error).toBe("Credential validation failed");
    });

    it("AWS keys: whitespace-only access key is treated as missing", async () => {
      const result = await validateAwsCredentials({
        authMode: "keys",
        identity: null,
        credentials: { cloud: "aws", aws_access_key_id: "   ", aws_secret_access_key: "secret" },
      });

      expect(result.proceed).toBe(false);
      expect(result.error).toBe("AWS Access Key ID is required");
    });

    it("Azure SP: whitespace-only tenant ID is treated as missing", async () => {
      const result = await validateAzureCredentials({
        authMode: "service_principal",
        account: null,
        credentials: {
          cloud: "azure",
          azure_tenant_id: "   ",
          azure_subscription_id: "sub",
          azure_client_id: "cid",
          azure_client_secret: "sec",
        },
      });

      expect(result.proceed).toBe(false);
      expect(result.error).toBe("Azure Tenant ID is required");
    });
  });
});
