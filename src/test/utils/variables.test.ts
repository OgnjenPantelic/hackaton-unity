import {
  formatVariableName,
  groupVariablesBySection,
  generateRandomSuffix,
  initializeFormDefaults,
} from "../../utils/variables";
import { TerraformVariable } from "../../types";
import { DEFAULTS } from "../../constants";

// Helper to create a minimal TerraformVariable
function makeVar(
  name: string,
  defaults?: Partial<TerraformVariable>
): TerraformVariable {
  return {
    name,
    description: defaults?.description ?? "",
    var_type: defaults?.var_type ?? "string",
    default: defaults?.default ?? null,
    required: defaults?.required ?? false,
    sensitive: defaults?.sensitive ?? false,
    validation: defaults?.validation ?? null,
  };
}

// ---------------------------------------------------------------------------
// formatVariableName
// ---------------------------------------------------------------------------
describe("formatVariableName", () => {
  it("returns a constant display name when one exists", () => {
    expect(formatVariableName("prefix")).toBe("Workspace Name");
    expect(formatVariableName("location")).toBe("Region");
    expect(formatVariableName("admin_user")).toBe("Admin Email");
  });

  it("converts snake_case to Title Case for unknown variables", () => {
    expect(formatVariableName("my_custom_var")).toBe("My Custom Var");
  });

  it("handles a single word", () => {
    expect(formatVariableName("foobar")).toBe("Foobar");
  });

  it("handles an empty string", () => {
    expect(formatVariableName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// groupVariablesBySection
// ---------------------------------------------------------------------------
describe("groupVariablesBySection", () => {
  it("groups known variables into the correct sections", () => {
    const vars = [makeVar("prefix"), makeVar("region"), makeVar("vpc_cidr_range")];
    const sections = groupVariablesBySection(vars);

    expect(sections["Workspace"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "prefix" }),
        expect.objectContaining({ name: "region" }),
      ])
    );
    expect(sections["Advanced: Network Configuration"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "vpc_cidr_range" })])
    );
  });

  it("puts unknown variables into 'Other Configuration'", () => {
    const vars = [makeVar("some_unknown_var")];
    const sections = groupVariablesBySection(vars);

    expect(sections["Other Configuration"]).toHaveLength(1);
    expect(sections["Other Configuration"][0].name).toBe("some_unknown_var");
  });

  it("excludes variables in EXCLUDE_VARIABLES", () => {
    const vars = [
      makeVar("databricks_account_id"),
      makeVar("aws_access_key_id"),
      makeVar("prefix"),
    ];
    const sections = groupVariablesBySection(vars);

    // Only prefix should appear
    const allVarNames = Object.values(sections)
      .flat()
      .map((v) => v.name);

    expect(allVarNames).toContain("prefix");
    expect(allVarNames).not.toContain("databricks_account_id");
    expect(allVarNames).not.toContain("aws_access_key_id");
  });

  it("returns an empty object for empty input", () => {
    expect(groupVariablesBySection([])).toEqual({});
  });

  it("handles a mix of known, unknown, and excluded variables", () => {
    const vars = [
      makeVar("prefix"),                  // known: Workspace
      makeVar("gcp_project_id"),          // excluded
      makeVar("my_custom_thing"),         // unknown: Other Configuration
      makeVar("cidr_block"),              // known: Advanced: Network Configuration
    ];
    const sections = groupVariablesBySection(vars);

    const allVarNames = Object.values(sections).flat().map((v) => v.name);
    expect(allVarNames).toEqual(
      expect.arrayContaining(["prefix", "my_custom_thing", "cidr_block"])
    );
    expect(allVarNames).not.toContain("gcp_project_id");
    expect(Object.keys(sections)).toEqual(
      expect.arrayContaining([
        "Workspace",
        "Advanced: Network Configuration",
        "Other Configuration",
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// generateRandomSuffix
// ---------------------------------------------------------------------------
describe("generateRandomSuffix", () => {
  it("returns a string of length 6", () => {
    expect(generateRandomSuffix()).toHaveLength(6);
  });

  it("returns only lowercase alphanumeric characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRandomSuffix()).toMatch(/^[a-z0-9]{6}$/);
    }
  });

  it("returns different values on consecutive calls", () => {
    const results = new Set(Array.from({ length: 50 }, () => generateRandomSuffix()));
    // With 36^6 possibilities, 50 calls should produce at least 2 unique values
    expect(results.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// initializeFormDefaults
// ---------------------------------------------------------------------------
describe("initializeFormDefaults", () => {
  it("sets prefix to '{default}-{randomSuffix}' pattern", () => {
    const vars = [makeVar("prefix", { default: "databricks" })];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.prefix).toMatch(/^databricks-[a-z0-9]{6}$/);
  });

  it("uses 'databricks' as base prefix when no default", () => {
    const vars = [makeVar("prefix")];
    const defaults = initializeFormDefaults(vars);

    // default is null → falsy → fallback to "databricks"
    // Actually: `v.default || "databricks"` — null is falsy, so falls back
    expect(defaults.prefix).toMatch(/^databricks-[a-z0-9]{6}$/);
  });

  it("sets workspace_name to 'databricks-ws-{randomSuffix}'", () => {
    const vars = [makeVar("workspace_name")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.workspace_name).toMatch(/^databricks-ws-[a-z0-9]{6}$/);
  });

  it("sets databricks_workspace_name the same as workspace_name", () => {
    const vars = [makeVar("databricks_workspace_name")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.databricks_workspace_name).toMatch(/^databricks-ws-[a-z0-9]{6}$/);
  });

  it("sets root_storage_name to 'dbstorage{shortSuffix}' without hyphens", () => {
    const vars = [makeVar("root_storage_name")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.root_storage_name).toMatch(/^dbstorage[a-z0-9]+$/);
    expect(defaults.root_storage_name).not.toContain("-");
  });

  it("sets vnet_name to empty string (filled by user when using existing VNet)", () => {
    const vars = [makeVar("vnet_name")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.vnet_name).toBe("");
  });

  it("sets vnet_resource_group_name to empty string", () => {
    const vars = [makeVar("vnet_resource_group_name")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.vnet_resource_group_name).toBe("");
  });

  it("sets subnet CIDRs to DEFAULTS values", () => {
    const vars = [makeVar("subnet_public_cidr"), makeVar("subnet_private_cidr")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.subnet_public_cidr).toBe(DEFAULTS.PUBLIC_SUBNET_CIDR);
    expect(defaults.subnet_private_cidr).toBe(DEFAULTS.PRIVATE_SUBNET_CIDR);
  });

  it("sets location to empty string to force explicit selection", () => {
    const vars = [makeVar("location")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.location).toBe("");
  });

  it("sets google_region to empty string even when variable has a default", () => {
    const vars = [makeVar("google_region", { default: "europe-west1" })];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.google_region).toBe("");
  });

  it("sets google_region to empty string to force explicit selection", () => {
    const vars = [makeVar("google_region")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.google_region).toBe("");
  });

  it("sets admin_user from context.azureUser when provided", () => {
    const vars = [makeVar("admin_user")];
    const defaults = initializeFormDefaults(vars, { azureUser: "azure@test.com" });

    expect(defaults.admin_user).toBe("azure@test.com");
  });

  it("sets admin_user from context.gcpAccount when provided", () => {
    const vars = [makeVar("admin_user")];
    const defaults = initializeFormDefaults(vars, { gcpAccount: "gcp@test.com" });

    expect(defaults.admin_user).toBe("gcp@test.com");
  });

  it("sets create_new_resource_group to true", () => {
    const vars = [makeVar("create_new_resource_group")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.create_new_resource_group).toBe(true);
  });

  it("uses the variable's own default when present for generic variables", () => {
    const vars = [makeVar("some_var", { default: "my_default" })];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.some_var).toBe("my_default");
  });

  it("falls back to empty string when no default exists", () => {
    const vars = [makeVar("some_var")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.some_var).toBe("");
  });

  it("sets AWS subnet defaults from cidr_block variable default", () => {
    const vars = [
      makeVar("cidr_block", { default: "10.4.0.0/16" }),
      makeVar("private_subnet_1_cidr"),
      makeVar("private_subnet_2_cidr"),
      makeVar("public_subnet_cidr"),
    ];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.private_subnet_1_cidr).toBe("10.4.0.0/18");
    expect(defaults.private_subnet_2_cidr).toBe("10.4.64.0/18");
    expect(defaults.public_subnet_cidr).toBe("10.4.128.0/28");
  });

  it("uses fallback cidr_block when no default present", () => {
    const vars = [
      makeVar("cidr_block"),
      makeVar("private_subnet_1_cidr"),
    ];
    const defaults = initializeFormDefaults(vars);

    // Falls back to "10.4.0.0/16"
    expect(defaults.private_subnet_1_cidr).toBe("10.4.0.0/18");
  });

  it("sets resource_suffix with randomSuffix", () => {
    const vars = [makeVar("resource_suffix")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.resource_suffix).toMatch(/^sra[a-z0-9]{6}$/);
  });

  it("sets resource_prefix with randomSuffix", () => {
    const vars = [makeVar("resource_prefix")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.resource_prefix).toMatch(/^dbx[a-z0-9]{6}$/);
  });

  it("sets hub_resource_suffix with shortSuffix", () => {
    const vars = [makeVar("hub_resource_suffix")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.hub_resource_suffix).toMatch(/^hub[a-z0-9]+$/);
    expect(defaults.hub_resource_suffix).not.toContain("-");
  });

  it("sets workspace_sku to premium", () => {
    const vars = [makeVar("workspace_sku")];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.workspace_sku).toBe("premium");
  });

  it("sets boolean flags to false when they have null defaults", () => {
    const vars = [
      makeVar("use_existing_cmek", { default: null }),
      makeVar("metastore_exists", { default: null }),
    ];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.use_existing_cmek).toBe(false);
    expect(defaults.metastore_exists).toBe(false);
  });

  it("does not override boolean flags that have explicit non-null defaults", () => {
    const vars = [makeVar("use_existing_cmek", { default: "true" })];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.use_existing_cmek).toBe("true");
  });

  it("skips complex HCL default values (non-JSON maps/lists)", () => {
    const vars = [makeVar("tags", { default: "{ Environment = \"dev\" }" })];
    const defaults = initializeFormDefaults(vars);

    // Complex HCL is skipped entirely, falling through to the empty-string branch
    expect(defaults.tags).toBeUndefined();
  });

  it("skips terraform null defaults", () => {
    const vars = [makeVar("optional_field", { default: "null" })];
    const defaults = initializeFormDefaults(vars);

    // "null" defaults are skipped, falling through to the empty-string branch
    expect(defaults.optional_field).toBeUndefined();
  });

  it("sets AWS SRA defaults", () => {
    const vars = [
      makeVar("vpc_cidr_range"),
      makeVar("hub_vnet_cidr"),
    ];
    const defaults = initializeFormDefaults(vars);

    expect(defaults.vpc_cidr_range).toBe("10.0.0.0/16");
    expect(defaults.hub_vnet_cidr).toBe("10.100.0.0/20");
  });

  it("prefers azureUser over gcpAccount for admin_user", () => {
    const vars = [makeVar("admin_user")];
    const defaults = initializeFormDefaults(vars, {
      azureUser: "azure@test.com",
      gcpAccount: "gcp@test.com",
    });

    expect(defaults.admin_user).toBe("azure@test.com");
  });
});
