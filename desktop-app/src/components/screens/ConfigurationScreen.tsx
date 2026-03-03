import React, { useMemo, useState } from "react";
import { 
  CLOUDS, 
  AWS_REGIONS, 
  AZURE_REGIONS, 
  GCP_REGIONS, 
  EXCLUDE_VARIABLES,
  VARIABLE_DESCRIPTION_OVERRIDES,
  CONDITIONAL_FIELD_VISIBILITY,
  CONDITIONAL_SELECT_VISIBILITY,
  OBJECT_FIELD_DECOMPOSITION,
  LIST_FIELD_DECOMPOSITION,
  COMPLIANCE_STANDARDS,
  FQDN_GROUPS,
} from "../../constants";
import type { ObjectSubField } from "../../constants";
import { TerraformVariable } from "../../types";
import { groupVariablesBySection, formatVariableName } from "../../utils/variables";
import { computeSubnets, computeAwsSubnets, computeAwsSraSubnets, cidrsOverlap, parseCidr, getUsableNodes } from "../../utils/cidr";
import { useWizard } from "../../hooks/useWizard";

const KNOWN_BOOLEANS = new Set([
  "create_new_vpc",
  "use_existing_cmek",
  "use_existing_pas",
  "metastore_exists",
  "audit_log_delivery_exists",
  "create_workspace_resource_group",
  "create_hub",
  "create_workspace_vnet",
  "cmk_enabled",
  "enable_compliance_security_profile",
  "enable_security_analysis_tool",
]);

const COLLAPSIBLE_SECTIONS = new Set([
  "Advanced: Network Configuration",
  "Security Group Egress Ports",
  "Security & Compliance",
  "Metastore & Catalog",
  "Optional Settings",
  "Other Configuration",
  "Tags",
]);

export function ConfigurationScreen() {
  const {
    selectedTemplate, selectedCloud,
    variables, formValues, setFormValues,
    tagPairs, setTagPairs,
    loading, error,
    showAdvanced, setShowAdvanced,
    formSubmitAttempted, setFormSubmitAttempted,
    setScreen, goBack,
    startDeploymentWizard,
    azure,
  } = useWizard();
  const azureResourceGroups = azure.resourceGroups;
  const azureVnets = azure.vnets;
  const loadCollapseState = (key: string, def: boolean) => {
    try { const v = localStorage.getItem(`cfg_${key}`); return v !== null ? v === "true" : def; } catch { return def; }
  };
  const persistCollapse = (key: string, val: boolean) => {
    try { localStorage.setItem(`cfg_${key}`, String(val)); } catch { /* noop */ }
  };
  const [showTags, _setShowTags] = useState(() => loadCollapseState("tags", false));
  const [showSecurity, _setShowSecurity] = useState(() => loadCollapseState("security", false));
  const [showMetastore, _setShowMetastore] = useState(() => loadCollapseState("metastore", false));
  const [showOptional, _setShowOptional] = useState(() => loadCollapseState("optional", false));
  const [showOther, _setShowOther] = useState(() => loadCollapseState("other", false));
  const [showSgPorts, _setShowSgPorts] = useState(() => loadCollapseState("sgPorts", false));
  const setShowTags = (v: boolean) => { _setShowTags(v); persistCollapse("tags", v); };
  const setShowSecurity = (v: boolean) => { _setShowSecurity(v); persistCollapse("security", v); };
  const setShowMetastore = (v: boolean) => { _setShowMetastore(v); persistCollapse("metastore", v); };
  const setShowOptional = (v: boolean) => { _setShowOptional(v); persistCollapse("optional", v); };
  const setShowOther = (v: boolean) => { _setShowOther(v); persistCollapse("other", v); };
  const setShowSgPorts = (v: boolean) => { _setShowSgPorts(v); persistCollapse("sgPorts", v); };
  const createNewVpc = formValues["create_new_vpc"] !== false && formValues["create_new_vpc"] !== "false";
  const isSraTemplate = selectedTemplate?.id?.includes("sra") ?? false;
  const onContinue = () => {
    if (isSraTemplate) {
      startDeploymentWizard();
    } else {
      setScreen("unity-catalog-config");
    }
  };
  const onBack = goBack;
  
  const handleFormChange = (name: string, value: any) => {
    setFormValues((prev) => {
      const updated = { ...prev, [name]: value };
      // Auto-fill vnet_resource_group_name when resource_group_name changes
      if (name === "resource_group_name" && selectedCloud === CLOUDS.AZURE) {
        updated["vnet_resource_group_name"] = value;
        // Set create_new_resource_group based on whether this is an existing RG
        const isExistingRg = azureResourceGroups.some(rg => rg.name === value);
        updated["create_new_resource_group"] = !isExistingRg;
      }
      // When toggling create_new_vnet to true, sync vnet_resource_group_name from resource_group_name
      if (name === "create_new_vnet" && value === true && selectedCloud === CLOUDS.AZURE) {
        updated["vnet_resource_group_name"] = prev["resource_group_name"] || "";
      }
      // Auto-fill subnets when VNet CIDR changes (2 prefix lengths smaller)
      if (name === "cidr" && selectedCloud === CLOUDS.AZURE) {
        const subnets = computeSubnets(value);
        if (subnets) {
          updated["subnet_public_cidr"] = subnets.publicCidr;
          updated["subnet_private_cidr"] = subnets.privateCidr;
        }
      }
      // Auto-fill subnets when VPC CIDR changes (AWS simple)
      if (name === "cidr_block" && selectedCloud === CLOUDS.AWS) {
        const subnets = computeAwsSubnets(value);
        if (subnets) {
          updated["private_subnet_1_cidr"] = subnets.private1Cidr;
          updated["private_subnet_2_cidr"] = subnets.private2Cidr;
          updated["public_subnet_cidr"] = subnets.publicCidr;
        }
      }
      // Auto-fill subnets when VPC CIDR changes (AWS SRA)
      if (name === "vpc_cidr_range" && selectedCloud === CLOUDS.AWS) {
        const sra = computeAwsSraSubnets(value);
        if (sra) {
          updated["private_subnets_cidr_1"] = sra.private1;
          updated["private_subnets_cidr_2"] = sra.private2;
          updated["privatelink_subnets_cidr_1"] = sra.privatelink1;
          updated["privatelink_subnets_cidr_2"] = sra.privatelink2;
        }
      }
      return updated;
    });
  };

  const updateTagsFormValue = (pairs: { key: string; value: string }[]) => {
    const validPairs = pairs.filter(p => p.key.trim() !== "");
    if (validPairs.length === 0) {
      setFormValues(prev => ({ ...prev, tags: "" }));
    } else {
      const tagObj: Record<string, string> = {};
      validPairs.forEach(p => { tagObj[p.key] = p.value; });
      setFormValues(prev => ({ ...prev, tags: JSON.stringify(tagObj) }));
    }
  };

  const handleTagChange = (index: number, field: "key" | "value", value: string) => {
    setTagPairs(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      updateTagsFormValue(updated);
      return updated;
    });
  };

  const addTag = () => {
    setTagPairs(prev => [...prev, { key: "", value: "" }]);
  };

  const removeTag = (index: number) => {
    setTagPairs(prev => {
      const updated = prev.filter((_, i) => i !== index);
      updateTagsFormValue(updated);
      return updated;
    });
  };

  // Check if the entered VNet CIDR overlaps with any existing Azure VNets
  const vnetOverlap = useMemo(() => {
    if (selectedCloud !== CLOUDS.AZURE || !formValues["cidr"]) return null;
    const enteredCidr = formValues["cidr"];
    if (!parseCidr(enteredCidr)) return null;

    for (const vnet of azureVnets) {
      for (const prefix of vnet.address_prefixes) {
        if (cidrsOverlap(enteredCidr, prefix)) {
          return { vnetName: vnet.name, resourceGroup: vnet.resource_group, cidr: prefix };
        }
      }
    }
    return null;
  }, [selectedCloud, formValues["cidr"], azureVnets]);

  // Field visibility and validation depend on cloud and network toggles:
  // - AWS: createNewVpc controls new VPC vs existing VPC fields
  // - Azure: create_new_vnet controls new VNet vs existing VNet fields
  // - SRA templates: boolean and select toggles control related fields
  // - hiddenFields: fields not shown (thus not validated)
  // - conditionallyRequired: required only when toggle is in given state
  
  // Determine which fields are hidden by toggles (should not be validated)
  const createNewVnetValue = formValues.create_new_vnet;
  const createNewVnet = createNewVnetValue === true || createNewVnetValue === "true" || createNewVnetValue === undefined;
  const variableNames = useMemo(() => new Set(variables.map(v => v.name)), [variables]);
  const hiddenFields = useMemo(() => {
    const hidden = new Set<string>();
    // Azure simple: hidden fields based on VNet toggle
    if (createNewVnet) {
      hidden.add("vnet_name");
    } else {
      hidden.add("cidr");
    }
    // AWS simple: handled by CONDITIONAL_FIELD_VISIBILITY via formValues["create_new_vpc"]

    // SRA: boolean toggle conditional visibility
    for (const rule of CONDITIONAL_FIELD_VISIBILITY) {
      if (!variableNames.has(rule.toggle)) continue;
      const val = formValues[rule.toggle];
      const isChecked = val === true || val === "true" || (val === undefined && rule.defaultChecked);
      if (isChecked) {
        rule.showWhenUnchecked.forEach(f => hidden.add(f));
      } else {
        rule.showWhenChecked.forEach(f => hidden.add(f));
      }
    }

    // SRA: select/string toggle conditional visibility
    for (const rule of CONDITIONAL_SELECT_VISIBILITY) {
      if (!variableNames.has(rule.toggle)) continue;
      const val = (formValues[rule.toggle] as string) || rule.defaultValue;
      const allControlledFields = new Set(rule.options.flatMap(o => o.showFields));
      const activeOption = rule.options.find(o => o.value === val);
      const visibleFields = new Set(activeOption?.showFields ?? []);
      allControlledFields.forEach(f => {
        if (!visibleFields.has(f)) hidden.add(f);
      });
    }

    return hidden;
  }, [formValues, createNewVnet, variableNames]);

  // Fields that are always required in the UI, even if they have Terraform defaults
  const alwaysRequired = new Set<string>([
    "prefix", "workspace_name", "databricks_workspace_name", "admin_user",
    "region", "location", "google_region", "workspace_sku", "network_configuration",
  ]);

  // Conditionally required fields based on toggle state and template type
  const isAwsSra = selectedTemplate?.id === "aws-sra";
  const isAzureSra = selectedTemplate?.id === "azure-sra";
  const isGcpSra = selectedTemplate?.id === "gcp-sra";

  const conditionallyRequired = new Set<string>();
  if (selectedCloud === CLOUDS.AWS && !isAwsSra) {
    if (createNewVpc) {
      conditionallyRequired.add("cidr_block");
    } else {
      conditionallyRequired.add("existing_vpc_id");
      conditionallyRequired.add("existing_subnet_ids");
      conditionallyRequired.add("existing_security_group_id");
    }
  }
  if (selectedCloud === CLOUDS.AZURE && !isAzureSra) {
    conditionallyRequired.add("vnet_resource_group_name");
    if (createNewVnet) {
      conditionallyRequired.add("cidr");
      conditionallyRequired.add("subnet_public_cidr");
      conditionallyRequired.add("subnet_private_cidr");
    } else {
      conditionallyRequired.add("vnet_name");
      conditionallyRequired.add("subnet_public_cidr");
      conditionallyRequired.add("subnet_private_cidr");
    }
  }
  if (selectedCloud === CLOUDS.GCP && !isGcpSra) {
    conditionallyRequired.add("subnet_cidr");
  }

  // --- Metastore ID required when metastore_exists is true (all SRA templates) ---
  if (isAwsSra || isAzureSra || isGcpSra) {
    const metastoreExists = formValues["metastore_exists"] === true || formValues["metastore_exists"] === "true";
    if (metastoreExists) {
      conditionallyRequired.add("existing_metastore_id");
    }
  }

  // --- AWS SRA conditionally required ---
  if (isAwsSra) {
    const networkMode = (formValues["network_configuration"] as string) || "isolated";
    if (networkMode === "isolated") {
      conditionallyRequired.add("vpc_cidr_range");
      conditionallyRequired.add("private_subnets_cidr_1");
      conditionallyRequired.add("private_subnets_cidr_2");
      conditionallyRequired.add("privatelink_subnets_cidr_1");
      conditionallyRequired.add("privatelink_subnets_cidr_2");
    } else {
      conditionallyRequired.add("custom_vpc_id");
      conditionallyRequired.add("custom_private_subnet_ids_1");
      conditionallyRequired.add("custom_private_subnet_ids_2");
      conditionallyRequired.add("custom_sg_id");
    }
  }

  // --- Azure SRA conditionally required ---
  if (isAzureSra) {
    const createHub = formValues["create_hub"];
    const hubEnabled = createHub === true || createHub === "true" || createHub === undefined;
    const createWsVnet = formValues["create_workspace_vnet"];
    const wsVnetEnabled = createWsVnet === true || createWsVnet === "true" || createWsVnet === undefined;

    if (hubEnabled) {
      conditionallyRequired.add("hub_vnet_cidr");
      conditionallyRequired.add("hub_resource_suffix");
    } else {
      conditionallyRequired.add("databricks_metastore_id");
      conditionallyRequired.add("existing_ncc_id");
      conditionallyRequired.add("existing_network_policy_id");
      conditionallyRequired.add("existing_hub_vnet__route_table_id");
      conditionallyRequired.add("existing_hub_vnet__vnet_id");
      const cmkOn = formValues["cmk_enabled"];
      if (cmkOn === true || cmkOn === "true" || cmkOn === undefined) {
        conditionallyRequired.add("existing_cmk_ids__key_vault_id");
        conditionallyRequired.add("existing_cmk_ids__managed_disk_key_id");
        conditionallyRequired.add("existing_cmk_ids__managed_services_key_id");
      }
    }
    if (wsVnetEnabled) {
      conditionallyRequired.add("workspace_vnet__cidr");
    } else {
      conditionallyRequired.add("existing_workspace_vnet__nc__vnet_id");
      conditionallyRequired.add("existing_workspace_vnet__nc__private_subnet");
      conditionallyRequired.add("existing_workspace_vnet__nc__public_subnet");
      conditionallyRequired.add("existing_workspace_vnet__nc__pe_subnet");
      conditionallyRequired.add("existing_workspace_vnet__nc__priv_nsg");
      conditionallyRequired.add("existing_workspace_vnet__nc__pub_nsg");
      conditionallyRequired.add("existing_workspace_vnet__dns__backend");
      conditionallyRequired.add("existing_workspace_vnet__dns__dfs");
      conditionallyRequired.add("existing_workspace_vnet__dns__blob");
    }
  }

  // --- GCP SRA conditionally required ---
  if (isGcpSra) {
    const useExistingCmek = formValues["use_existing_cmek"];
    const cmekExisting = useExistingCmek === true || useExistingCmek === "true";
    if (cmekExisting) {
      conditionallyRequired.add("cmek_resource_id");
    } else {
      conditionallyRequired.add("key_name");
      conditionallyRequired.add("keyring_name");
    }
    const useExistingPas = formValues["use_existing_pas"];
    if (useExistingPas === true || useExistingPas === "true") {
      conditionallyRequired.add("existing_pas_id");
    }
    conditionallyRequired.add("workspace_pe");
    conditionallyRequired.add("relay_pe");
    conditionallyRequired.add("google_pe_subnet");
    conditionallyRequired.add("relay_service_attachment");
    conditionallyRequired.add("workspace_service_attachment");
    conditionallyRequired.add("account_console_url");
  }

  // Combined set of all required field names (for label rendering)
  const allRequiredFields = new Set<string>([
    ...alwaysRequired,
    ...conditionallyRequired,
  ]);

  // Validation: Terraform-required vars + always-required + conditionally required.
  // Also validates prefix/workspace_name format (lowercase, hyphens, length).
  
  // Memoized validation for required form fields
  const formValidation = useMemo(() => {
    // Terraform-required (no default) + always-required (have defaults but must be filled)
    const requiredVars = variables.filter(v => 
      !EXCLUDE_VARIABLES.includes(v.name as any) &&
      !hiddenFields.has(v.name) &&
      ((v.required && !v.default) || alwaysRequired.has(v.name))
    );
    
    const missingFields = requiredVars.filter(v => {
      // Skip list-decomposed parents; their sub-fields are validated via conditionallyRequired
      if (LIST_FIELD_DECOMPOSITION[v.name]) return false;
      const value = formValues[v.name];
      return value === undefined || value === null || value === "";
    });

    // Add conditionally required fields that are empty
    const conditionalMissing = [...conditionallyRequired].filter(name => {
      const value = formValues[name];
      return value === undefined || value === null || value === "" || 
        (Array.isArray(value) && value.length === 0);
    });
    
    const fieldErrors: Record<string, string> = {};
    const prefixValue = formValues["prefix"];
    if (prefixValue) {
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(prefixValue)) {
        fieldErrors["prefix"] = "Must start and end with a letter or number, contain only lowercase letters, numbers, and hyphens";
      } else if (prefixValue.length < 3 || prefixValue.length > 30) {
        fieldErrors["prefix"] = "Must be between 3 and 30 characters";
      } else if (/--/.test(prefixValue)) {
        fieldErrors["prefix"] = "Cannot contain consecutive hyphens";
      }
    }
    
    const gcpWorkspaceName = formValues["databricks_workspace_name"];
    if (gcpWorkspaceName) {
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(gcpWorkspaceName)) {
        fieldErrors["databricks_workspace_name"] = "Must start and end with a letter or number, contain only lowercase letters, numbers, and hyphens";
      } else if (gcpWorkspaceName.length < 3 || gcpWorkspaceName.length > 30) {
        fieldErrors["databricks_workspace_name"] = "Must be between 3 and 30 characters";
      } else if (/--/.test(gcpWorkspaceName)) {
        fieldErrors["databricks_workspace_name"] = "Cannot contain consecutive hyphens";
      }
    }

    for (const sfx of ["resource_suffix", "hub_resource_suffix"]) {
      const val = formValues[sfx];
      if (val && typeof val === "string") {
        if (!/^[a-z0-9]+$/.test(val)) {
          fieldErrors[sfx] = "Only lowercase letters and numbers allowed (no hyphens or special characters). Used in Azure storage account names.";
        } else if (val.length > 20) {
          fieldErrors[sfx] = "Must be 20 characters or fewer.";
        }
      }
    }

    const allMissing = [
      ...missingFields.map(v => v.name),
      ...conditionalMissing,
    ];
    
    return {
      isValid: allMissing.length === 0 && Object.keys(fieldErrors).length === 0,
      missingFields: allMissing,
      requiredFields: [...requiredVars.map(v => v.name), ...conditionallyRequired],
      fieldErrors,
    };
  }, [variables, formValues, hiddenFields, conditionallyRequired]);

  const sectionErrorCounts = useMemo(() => {
    if (!formSubmitAttempted) return {};
    const counts: Record<string, number> = {};
    const secs = groupVariablesBySection(variables, selectedTemplate?.id);
    for (const [secName, secVars] of Object.entries(secs)) {
      let count = 0;
      for (const v of secVars) {
        if (hiddenFields.has(v.name)) continue;
        if (formValidation.missingFields.includes(v.name)) count++;
        if (formValidation.fieldErrors[v.name]) count++;
        const ld = LIST_FIELD_DECOMPOSITION[v.name];
        if (ld) {
          for (const sf of ld) {
            if (allRequiredFields.has(sf.key) && !formValues[sf.key]) count++;
          }
        }
      }
      if (count > 0) counts[secName] = count;
    }
    return counts;
  }, [formSubmitAttempted, variables, hiddenFields, formValidation, formValues, allRequiredFields]);

  const scrollToFirstError = () => {
    setTimeout(() => {
      const el = document.querySelector(".input-error");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  if (!selectedTemplate || loading) {
    return (
      <div className="container">
        <div className="loading">Loading configuration...</div>
      </div>
    );
  }

  const sections = groupVariablesBySection(variables, selectedTemplate?.id);

  const isBoolField = (v: TerraformVariable) =>
    v.var_type.includes("bool") || KNOWN_BOOLEANS.has(v.name);

  const sectionToggle: Record<string, [boolean, (v: boolean) => void]> = {
    "Advanced: Network Configuration": [showAdvanced, setShowAdvanced],
    "Security Group Egress Ports": [showSgPorts, setShowSgPorts],
    "Security & Compliance": [showSecurity, setShowSecurity],
    "Metastore & Catalog": [showMetastore, setShowMetastore],
    "Optional Settings": [showOptional, setShowOptional],
    "Other Configuration": [showOther, setShowOther],
    "Tags": [showTags, setShowTags],
  };

  const sectionSubtitles: Record<string, string> = {
    "Advanced: Network Configuration": "Network settings have sensible defaults. Modify only if you have specific requirements.",
    "Security Group Egress Ports": "Pre-filled with Databricks-required ports. Rarely needs changes.",
    "Security & Compliance": "Security profiles, encryption, and compliance settings.",
    "Metastore & Catalog": "Configure Unity Catalog metastore and workspace catalog.",
    "Optional Settings": "These settings have sensible defaults. Expand to customize.",
    "Other Configuration": "Additional configuration options.",
    "Tags": "Optional key-value pairs to tag all created resources for cost tracking and organization.",
  };

  const renderSubField = (sf: ObjectSubField) => {
    const satEnabled = formValues["sat__enabled"] === true || formValues["sat__enabled"] === "true";
    if (["sat__schema_name", "sat__catalog_name", "sat__run_on_serverless"].includes(sf.key) && !satEnabled) {
      return null;
    }
    if (sf.key === "wsc__csp_standards") {
      const cspEnabled = formValues["wsc__csp_enabled"] === true || formValues["wsc__csp_enabled"] === "true";
      if (!cspEnabled) return null;
      const standards = COMPLIANCE_STANDARDS.azure || [];
      const selected: string[] = (() => {
        const val = formValues[sf.key];
        if (Array.isArray(val)) return val;
        if (typeof val === "string" && val.trim()) {
          try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
        }
        return [];
      })();
      return (
        <div key={sf.key} className="form-group">
          <label>{sf.label}</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {standards.map((s) => (
              <label key={s.value} className="checkbox-label" style={{ fontSize: "0.9em" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.value)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, s.value]
                      : selected.filter((x) => x !== s.value);
                    handleFormChange(sf.key, JSON.stringify(next));
                  }}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="help-text">{sf.description}</div>
        </div>
      );
    }

    return (
    <div key={sf.key} className="form-group">
      <label>
        {sf.label}
        {sf.required && " *"}
      </label>
      {sf.fieldType === "bool" ? (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={formValues[sf.key] === "true" || formValues[sf.key] === true}
            onChange={(e) => handleFormChange(sf.key, e.target.checked)}
          />
          Enabled
        </label>
      ) : sf.fieldType === "select" && sf.key === "workspace_vnet__new_bits" ? (
        <select
          value={formValues[sf.key] ?? "2"}
          onChange={(e) => handleFormChange(sf.key, Number(e.target.value))}
        >
          <option value="1">1 — larger subnets, fewer divisions</option>
          <option value="2">2 — balanced (default, recommended)</option>
          <option value="3">3 — smaller subnets, more divisions</option>
          <option value="4">4 — smallest subnets</option>
        </select>
      ) : (
        <input
          type={sf.sensitive ? "password" : sf.fieldType === "number" ? "number" : "text"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={formValues[sf.key] || ""}
          onChange={(e) => handleFormChange(sf.key, sf.fieldType === "number" ? (e.target.value ? Number(e.target.value) : "") : e.target.value)}
          placeholder={sf.placeholder || ""}
        />
      )}
      <div className="help-text">{sf.description}</div>
    </div>
  );};

  const renderField = (variable: TerraformVariable) => {
    const decomposition = OBJECT_FIELD_DECOMPOSITION[variable.name];
    if (variable.name === "sat_service_principal" && !(formValues["sat__enabled"] === true || formValues["sat__enabled"] === "true")) {
      return null;
    }
    if (decomposition) {
      return (
        <div key={variable.name} style={{ gridColumn: "1 / -1" }}>
          <div style={{
            padding: "12px 16px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.06)",
            marginBottom: "4px",
          }}>
            <h4 style={{ margin: "0 0 4px 0", fontSize: "0.95em", color: "#e0e0e0" }}>
              {formatVariableName(variable.name)}
            </h4>
            {(VARIABLE_DESCRIPTION_OVERRIDES[variable.name] || variable.description) && (
              <div className="help-text" style={{ marginBottom: "12px" }}>
                {VARIABLE_DESCRIPTION_OVERRIDES[variable.name] || variable.description}
              </div>
            )}
            <div className="two-column">
              {decomposition.map(renderSubField)}
            </div>
          </div>
        </div>
      );
    }

    // List decomposition: render individual sub-fields instead of a single list input
    const listDecomp = LIST_FIELD_DECOMPOSITION[variable.name];
    if (listDecomp) {
      return (
        <React.Fragment key={variable.name}>
          {listDecomp.map(sf => (
            <div key={sf.key} className="form-group">
              <label>
                {sf.label}
                {sf.required && allRequiredFields.has(sf.key) && " *"}
              </label>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={formValues[sf.key] || ""}
                onChange={(e) => handleFormChange(sf.key, e.target.value)}
                placeholder={sf.placeholder || ""}
                className={formSubmitAttempted && allRequiredFields.has(sf.key) && !formValues[sf.key] ? "input-error" : ""}
              />
              <div className="help-text">{sf.description}</div>
              {(() => {
                const sfVal = formValues[sf.key];
                if (!sfVal || typeof sfVal !== "string") return null;
                const sfParsed = parseCidr(sfVal);
                if (!sfParsed) return null;
                let sfWarn: string | null = null;
                if (sf.key.startsWith("private_subnets_cidr_") && (sfParsed.prefixLen < 17 || sfParsed.prefixLen > 26))
                  sfWarn = `⚠ Subnet /${sfParsed.prefixLen} is outside the Databricks recommended /17–/26 range.`;
                else if (sf.key.startsWith("privatelink_subnets_cidr_") && sfParsed.prefixLen < 27)
                  sfWarn = `⚠ PrivateLink subnet /${sfParsed.prefixLen} is larger than needed. Recommended: /28 (only hosts a few ENIs).`;
                if (!sfWarn) return null;
                return <div className="help-text" style={{ color: "#ffb347" }}>{sfWarn}</div>;
              })()}
            </div>
          ))}
        </React.Fragment>
      );
    }

    const subnetFields = ["subnet_public_cidr", "subnet_private_cidr", "subnet_cidr", "private_subnet_1_cidr", "private_subnet_2_cidr", "public_subnet_cidr"];
    const isSubnetField = subnetFields.includes(variable.name);
    const fieldValue = formValues[variable.name] || "";
    const fieldParsed = isSubnetField ? parseCidr(fieldValue) : null;

    return (
      <div key={variable.name} className="form-group" style={variable.name === "tags" ? { gridColumn: "1 / -1" } : undefined}>
        <label>
          {formatVariableName(variable.name)}
          {((variable.required && !variable.default) || allRequiredFields.has(variable.name)) && " *"}
        </label>
        {isBoolField(variable) ? (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formValues[variable.name] === "true" || formValues[variable.name] === true}
              onChange={(e) => handleFormChange(variable.name, e.target.checked)}
            />
            Enabled
          </label>
        ) : variable.name === "workspace_sku" ? (
          <select
            value={formValues[variable.name] || ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            className={formSubmitAttempted && !formValues[variable.name] ? "input-error" : ""}
          >
            <option value="" disabled>Please select SKU</option>
            <option value="premium">Premium</option>
            <option value="trial">Trial</option>
          </select>
        ) : variable.name === "region" ? (
          <select
            value={formValues[variable.name] || ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            className={formSubmitAttempted && !formValues[variable.name] ? "input-error" : ""}
          >
            <option value="" disabled>Please select region</option>
            {AWS_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        ) : variable.name === "location" ? (
          <select
            value={formValues[variable.name] || ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            className={formSubmitAttempted && !formValues[variable.name] ? "input-error" : ""}
          >
            <option value="" disabled>Please select region</option>
            {AZURE_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        ) : variable.name === "google_region" ? (
          <select
            value={formValues[variable.name] || ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            className={formSubmitAttempted && !formValues[variable.name] ? "input-error" : ""}
          >
            <option value="" disabled>Please select region</option>
            {GCP_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        ) : variable.name === "network_configuration" ? (
          <select
            value={formValues[variable.name] || ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            className={formSubmitAttempted && !formValues[variable.name] ? "input-error" : ""}
          >
            <option value="" disabled>Please select network mode</option>
            <option value="isolated">Isolated (no public internet)</option>
            <option value="custom">Custom (bring your own VPC)</option>
          </select>
        ) : variable.name === "resource_group_name" && azureResourceGroups.length > 0 ? (
          <>
            <select
              value={azureResourceGroups.some(rg => rg.name === formValues[variable.name]) ? formValues[variable.name] : ""}
              onChange={(e) => {
                const val = e.target.value;
                setFormValues(prev => ({
                  ...prev,
                  [variable.name]: val,
                  vnet_resource_group_name: val,
                  create_new_resource_group: val === "" ? true : false,
                }));
              }}
              className={formSubmitAttempted && formValidation.missingFields.includes(variable.name) ? "input-error" : ""}
            >
              <option value="">Select existing or create new below</option>
              {azureResourceGroups.map((rg) => (
                <option key={rg.name} value={rg.name}>
                  {rg.name} ({rg.location})
                </option>
              ))}
            </select>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={azureResourceGroups.some(rg => rg.name === formValues[variable.name]) ? "" : (formValues[variable.name] || "")}
              onChange={(e) => {
                const val = e.target.value;
                const isExisting = azureResourceGroups.some(
                  rg => rg.name.toLowerCase() === val.toLowerCase()
                );
                const actualName = isExisting 
                  ? azureResourceGroups.find(rg => rg.name.toLowerCase() === val.toLowerCase())?.name || val
                  : val;
                setFormValues(prev => ({
                  ...prev,
                  [variable.name]: actualName,
                  vnet_resource_group_name: actualName,
                  create_new_resource_group: !isExisting,
                }));
              }}
              placeholder="Or enter new resource group name"
              style={{ marginTop: "8px" }}
              className={formSubmitAttempted && formValidation.missingFields.includes(variable.name) ? "input-error" : ""}
            />
          </>
        ) : (variable.name === "allowed_fqdns" || variable.name === "hub_allowed_urls") && FQDN_GROUPS[variable.name] ? (() => {
          const groups = FQDN_GROUPS[variable.name];
          const currentUrls: string[] = (() => {
            const val = formValues[variable.name];
            if (Array.isArray(val)) return val;
            if (typeof val === "string" && val.trim()) {
              try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
            }
            return [];
          })();
          const isGroupChecked = (group: typeof groups[0]) =>
            group.urls.every((url) => currentUrls.includes(url));
          const toggleGroup = (group: typeof groups[0], checked: boolean) => {
            let next: string[];
            if (checked) {
              const toAdd = group.urls.filter((u) => !currentUrls.includes(u));
              next = [...currentUrls, ...toAdd];
            } else {
              const otherCheckedUrls = new Set(
                groups.filter((g) => g.id !== group.id && isGroupChecked(g)).flatMap((g) => g.urls)
              );
              next = currentUrls.filter((u) => !group.urls.includes(u) || otherCheckedUrls.has(u));
            }
            handleFormChange(variable.name, next);
          };
          const allGroupUrls = new Set(groups.flatMap((g) => g.urls));
          const customUrls = currentUrls.filter((u) => !allGroupUrls.has(u));
          const addCustomUrl = () => {
            handleFormChange(variable.name, [...currentUrls, ""]);
          };
          const updateCustomUrl = (idx: number, value: string) => {
            const customs = [...customUrls];
            customs[idx] = value;
            const groupUrls = currentUrls.filter((u) => allGroupUrls.has(u));
            handleFormChange(variable.name, [...groupUrls, ...customs.filter((u) => u !== "")]);
          };
          const removeCustomUrl = (idx: number) => {
            const customs = customUrls.filter((_, i) => i !== idx);
            const groupUrls = currentUrls.filter((u) => allGroupUrls.has(u));
            handleFormChange(variable.name, [...groupUrls, ...customs]);
          };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {groups.map((g) => (
                <label key={g.id} className="checkbox-label" style={{ fontSize: "0.9em" }}>
                  <input
                    type="checkbox"
                    checked={isGroupChecked(g)}
                    onChange={(e) => toggleGroup(g, e.target.checked)}
                  />
                  <span>
                    <strong>{g.label}</strong>
                    <span style={{ color: "#888", marginLeft: "8px" }}>{g.description}</span>
                  </span>
                </label>
              ))}
              <div className="help-text" style={{ marginTop: "4px" }}>
                {variable.name === "allowed_fqdns"
                  ? "If SAT is enabled, Azure Management and Python Packages are required."
                  : "If SAT runs on serverless, both groups are required."}
              </div>
              <div style={{ marginTop: "8px" }}>
                <div style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "6px" }}>Additional URLs</div>
                {customUrls.map((url, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "6px", alignItems: "center" }}>
                    <input
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={url}
                      onChange={(e) => updateCustomUrl(idx, e.target.value)}
                      placeholder="e.g. example.com or *.example.com"
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => removeCustomUrl(idx)}
                      style={{ background: "transparent", border: "1px solid #555", color: "#e74c3c",
                        borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "14px" }}
                      title="Remove URL">×</button>
                  </div>
                ))}
                <button type="button" onClick={addCustomUrl}
                  style={{ background: "transparent", border: "1px dashed #555", color: "#888",
                    borderRadius: "4px", padding: "6px 16px", cursor: "pointer", fontSize: "13px", width: "100%" }}>
                  + Add URL
                </button>
              </div>
            </div>
          );
        })() : variable.name === "compliance_standards" ? (() => {
          const cloudKey = selectedCloud === CLOUDS.AWS ? "aws" : selectedCloud === CLOUDS.AZURE ? "azure" : "gcp";
          const standards = COMPLIANCE_STANDARDS[cloudKey] || [];
          const selected: string[] = (() => {
            const val = formValues[variable.name];
            if (Array.isArray(val)) return val;
            if (typeof val === "string" && val.trim()) {
              try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
            }
            return [];
          })();
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {standards.map((s) => (
                <label key={s.value} className="checkbox-label" style={{ fontSize: "0.9em" }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.value)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, s.value]
                        : selected.filter((x) => x !== s.value);
                      handleFormChange(variable.name, next);
                    }}
                  />
                  {s.label}
                </label>
              ))}
              {selected.length === 0 && (
                <div className="help-text" style={{ marginTop: "4px" }}>Select at least one standard, or disable the Compliance Security Profile.</div>
              )}
            </div>
          );
        })() : variable.name === "tags" ? (
          <div className="tags-editor">
            {tagPairs.map((tag, index) => (
              <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={tag.key}
                  onChange={(e) => handleTagChange(index, "key", e.target.value)}
                  placeholder="Key (e.g., Environment)" style={{ flex: 1 }} />
                <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={tag.value}
                  onChange={(e) => handleTagChange(index, "value", e.target.value)}
                  placeholder="Value (e.g., Production)" style={{ flex: 1 }} />
                <button type="button" onClick={() => removeTag(index)}
                  style={{ background: "transparent", border: "1px solid #555", color: "#e74c3c",
                    borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "14px" }}
                  title="Remove tag">×</button>
              </div>
            ))}
            <button type="button" onClick={addTag}
              style={{ background: "transparent", border: "1px dashed #555", color: "#888",
                borderRadius: "4px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", width: "100%" }}>
              + Add Tag
            </button>
          </div>
        ) : (
          <input
            type={variable.sensitive ? "password" : "text"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={formValues[variable.name] || ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            placeholder={variable.default || ""}
            className={
              (formSubmitAttempted && formValidation.missingFields.includes(variable.name)) ||
              (formValidation.fieldErrors[variable.name]) ? "input-error" : ""
            }
          />
        )}
        {formValidation.fieldErrors[variable.name] && (
          <div className="help-text" style={{ color: "#e74c3c" }}>
            {formValidation.fieldErrors[variable.name]}
          </div>
        )}
        {(VARIABLE_DESCRIPTION_OVERRIDES[variable.name] || variable.description) && !formValidation.fieldErrors[variable.name] && (
          <div className="help-text">
            {VARIABLE_DESCRIPTION_OVERRIDES[variable.name] || variable.description}
          </div>
        )}
        {variable.name === "cidr" && vnetOverlap && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ This range overlaps with existing VNet &quot;{vnetOverlap.vnetName}&quot; ({vnetOverlap.cidr}) in {vnetOverlap.resourceGroup}
          </div>
        )}
        {(() => {
          const val = formValues[variable.name];
          if (!val || typeof val !== "string") return null;
          const p = parseCidr(val);
          if (!p) return null;
          let warn: string | null = null;
          if (variable.name === "cidr_block" && (p.prefixLen < 15 || p.prefixLen > 24))
            warn = `⚠ VPC prefix /${p.prefixLen} is outside the recommended /15–/24 range. Private subnets would be /${p.prefixLen + 2}, but Databricks requires /17–/26.`;
          else if (variable.name === "vpc_cidr_range" && (p.prefixLen < 15 || p.prefixLen > 24))
            warn = `⚠ VPC prefix /${p.prefixLen} is outside the recommended /15–/24 range. Private subnets should be /17–/26 for Databricks.`;
          else if (variable.name === "cidr" && (p.prefixLen < 16 || p.prefixLen > 24))
            warn = `⚠ VNet prefix /${p.prefixLen} is outside the recommended /16–/24 range.`;
          else if ((variable.name === "subnet_public_cidr" || variable.name === "subnet_private_cidr") && p.prefixLen > 26)
            warn = `⚠ Subnet /${p.prefixLen} is smaller than the Databricks recommended minimum of /26.`;
          else if (variable.name === "subnet_cidr" && (p.prefixLen < 16 || p.prefixLen > 26))
            warn = `⚠ Subnet prefix /${p.prefixLen} is outside the recommended /16–/26 range. Databricks recommends /19–/25 for optimal sizing.`;
          if (!warn) return null;
          return <div className="help-text" style={{ color: "#ffb347" }}>{warn}</div>;
        })()}
        {isSubnetField && fieldParsed && (
          <div className="help-text" style={{ color: "#4ec9b0", display: "flex", alignItems: "center", gap: "6px" }}>
            {variable.name === "public_subnet_cidr"
              ? `Suggested: fixed /${fieldParsed.prefixLen} for NAT gateway.`
              : variable.name.startsWith("private_subnet_")
                ? `Suggested: /${fieldParsed.prefixLen} (1/4 of VPC). Each subnet scales with VPC size.`
                : `Auto-filled with /${fieldParsed.prefixLen} prefix (2 higher than VNet), leaving space for future expansion.`
            }
            <span className="cidr-tooltip-wrapper">
              <span className="cidr-tooltip-icon">?</span>
              <span className="cidr-tooltip">
                <span className="cidr-tooltip-title">IP Address Requirements</span>
                <span className="cidr-tooltip-subtitle">Nodes = The maximum number of nodes that can be active <strong>concurrently</strong> in your workspace.</span>
                <table className="cidr-tooltip-table">
                  <thead><tr><th>Subnet</th><th>IPs</th><th>Nodes</th></tr></thead>
                  <tbody>
                    {[17,18,19,20,21,22,23,24,25,26].map(p => (
                      <tr key={p} className={p === fieldParsed.prefixLen ? "cidr-tooltip-active" : ""}>
                        <td>/{p}</td>
                        <td>{Math.pow(2, 32 - p).toLocaleString()}</td>
                        <td>{getUsableNodes(p).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </span>
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h1>Configure Deployment</h1>
      <p className="subtitle">
        Fill in the configuration values for your Databricks workspace deployment.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={(e) => e.preventDefault()}>
        {/* Non-collapsible sections (Workspace) */}
        {Object.entries(sections)
          .filter(([sectionName]) => !COLLAPSIBLE_SECTIONS.has(sectionName))
          .map(([sectionName, sectionVars]) => {
            const visibleVars = sectionVars.filter(v => !hiddenFields.has(v.name));
            if (visibleVars.length === 0) return null;
            return (
              <div key={sectionName} className={`form-section ${selectedCloud}`}>
                <h3>{sectionName}</h3>
                <div className="two-column">
                  {visibleVars.map(renderField)}
                </div>
              </div>
            );
          })}

        {/* Collapsible sections */}
        {Object.entries(sections)
          .filter(([sectionName]) => COLLAPSIBLE_SECTIONS.has(sectionName))
          .map(([sectionName, sectionVars]) => {
            const showCustomVpcToggle = sectionName === "Advanced: Network Configuration" && selectedCloud === CLOUDS.AWS && !sectionVars.some(v => v.name === "network_configuration");
            const visibleVars = sectionVars.filter(v => !hiddenFields.has(v.name) && !(showCustomVpcToggle && v.name === "create_new_vpc"));
            if (visibleVars.length === 0) return null;
            const toggle = sectionToggle[sectionName];
            if (!toggle) return null;
            const [isOpen, setIsOpen] = toggle;
            const subtitle = sectionSubtitles[sectionName];

            if (sectionName === "Tags") {
              return (
                <div key={sectionName} className={`form-section advanced ${isOpen ? "expanded" : ""}`}>
                  <h3
                    onClick={() => setIsOpen(!isOpen)}
                    style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <span style={{ fontSize: "12px" }}>{isOpen ? "▼" : "►"}</span>
                    Tags
                    {sectionErrorCounts["Tags"] && !isOpen && (
                      <span style={{
                        background: "var(--error)", color: "#fff", fontSize: "11px", fontWeight: 700,
                        padding: "1px 7px", borderRadius: "10px", marginLeft: "8px",
                      }}>
                        {sectionErrorCounts["Tags"]}
                      </span>
                    )}
                  </h3>
                  {isOpen && (
                    <>
                      {subtitle && <p style={{ color: "#888", marginBottom: "16px", fontSize: "0.85em" }}>{subtitle}</p>}
                      <div className="tags-editor">
                        {tagPairs.map((tag, index) => (
                          <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                            <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                              value={tag.key} onChange={(e) => handleTagChange(index, "key", e.target.value)}
                              placeholder="Key (e.g., Environment)" style={{ flex: 1 }} />
                            <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                              value={tag.value} onChange={(e) => handleTagChange(index, "value", e.target.value)}
                              placeholder="Value (e.g., Production)" style={{ flex: 1 }} />
                            <button type="button" onClick={() => removeTag(index)}
                              style={{ background: "transparent", border: "1px solid #555", color: "#e74c3c",
                                borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "14px" }}
                              title="Remove tag">×</button>
                          </div>
                        ))}
                        <button type="button" onClick={addTag}
                          style={{ background: "transparent", border: "1px dashed #555", color: "#888",
                            borderRadius: "4px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", width: "100%" }}>
                          + Add Tag
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            }

            return (
              <div key={sectionName} className={`form-section advanced ${isOpen ? "expanded" : ""}`}>
                <h3
                  onClick={() => setIsOpen(!isOpen)}
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span style={{ fontSize: "12px" }}>{isOpen ? "▼" : "►"}</span>
                  {sectionName}
                  {sectionErrorCounts[sectionName] && !isOpen && (
                    <span style={{
                      background: "var(--error)", color: "#fff", fontSize: "11px", fontWeight: 700,
                      padding: "1px 7px", borderRadius: "10px", marginLeft: "8px",
                    }}>
                      {sectionErrorCounts[sectionName]}
                    </span>
                  )}
                </h3>
                {isOpen && (
                  <>
                    {subtitle && <p style={{ color: "#888", marginBottom: "16px", fontSize: "0.85em" }}>{subtitle}</p>}
                    {showCustomVpcToggle && (
                      <div className="form-group" style={{ marginBottom: "16px" }}>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={createNewVpc}
                            onChange={(e) => {
                              handleFormChange("create_new_vpc", e.target.checked);
                              if (e.target.checked) {
                                setFormValues(prev => ({
                                  ...prev,
                                  existing_vpc_id: "",
                                  existing_subnet_ids: "",
                                  existing_security_group_id: "",
                                }));
                              }
                            }}
                          />
                          Create New VPC
                        </label>
                        <div className="help-text">
                          {createNewVpc 
                            ? "A new VPC will be created with the CIDR block below."
                            : "Use an existing VPC by providing its ID, subnet IDs, and security group ID."}
                        </div>
                      </div>
                    )}
                    <div className="two-column">
                      {visibleVars.map(renderField)}
                    </div>
                  </>
                )}
              </div>
            );
          })}

        <div className="sticky-footer">
          <button 
            className="btn btn-large btn-success" 
            onClick={() => {
              if (!formValidation.isValid) {
                setFormSubmitAttempted(true);
                scrollToFirstError();
              } else {
                onContinue();
              }
            }} 
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Preparing...
              </>
            ) : (
              isSraTemplate ? "Create Workspace →" : "Continue →"
            )}
          </button>
          {formSubmitAttempted && !formValidation.isValid && (
            <p style={{ marginTop: "12px", color: "var(--error)", fontSize: "0.9em" }}>
              {formValidation.missingFields.length > 0 && (
                <>Please fill in all required fields: {formValidation.missingFields.map(f => formatVariableName(f)).join(", ")}</>
              )}
              {formValidation.missingFields.length > 0 && Object.keys(formValidation.fieldErrors).length > 0 && <br />}
              {Object.keys(formValidation.fieldErrors).length > 0 && (
                <>Please fix validation errors: {Object.keys(formValidation.fieldErrors).map(f => formatVariableName(f)).join(", ")}</>
              )}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
