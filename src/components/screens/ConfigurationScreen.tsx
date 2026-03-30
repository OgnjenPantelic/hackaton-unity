import React, { useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, LinkifyText } from "../ui";
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
  FIELD_GROUPS,
  PLACEHOLDER_OVERRIDES,
} from "../../constants";
import type { ObjectSubField } from "../../constants";
import { TerraformVariable } from "../../types";
import { groupVariablesBySection, formatVariableName } from "../../utils/variables";
import { computeSubnets, computeAzurePlSubnets, computeAwsSubnets, computeAwsSraSubnets, cidrsOverlap, parseCidr, getUsableNodes } from "../../utils/cidr";
import { useWizard } from "../../hooks/useWizard";
import { usePersistedCollapse } from "../../hooks/usePersistedCollapse";

interface ResourceNameConflict {
  name: string;
  resource_type: string;
  has_deployer_tag: boolean;
  deployer_tag_value?: string;
}

const KNOWN_BOOLEANS = new Set([
  "create_new_vpc",
  "use_existing_cmek",
  "use_existing_pas",
  "metastore_exists",
  "audit_log_delivery_exists",
  "create_hub",
  "create_workspace_vnet",
  "cmk_enabled",
  "enable_compliance_security_profile",
  "enable_security_analysis_tool",
]);

const COLLAPSIBLE_SECTIONS = new Set([
  "Advanced: Network Configuration",
  "Hub Infrastructure",
  "Workspace Network",
  "Firewall Rules",
  "Encryption",
  "Security & Compliance",
  "Metastore & Catalog",
  "Additional Settings",
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
    credentials,
    aws,
    azure,
  } = useWizard();
  const azureResourceGroups = azure.resourceGroups;
  const azureVnets = azure.vnets;
  const awsVpcs = aws.vpcs;
  const [showTags, setShowTags] = usePersistedCollapse("tags", false);
  const [showSecurity, setShowSecurity] = usePersistedCollapse("security", false);
  const [showMetastore, setShowMetastore] = usePersistedCollapse("metastore", false);
  const [showAdditional, setShowAdditional] = usePersistedCollapse("optional", false);
  const [showOther, setShowOther] = usePersistedCollapse("other", false);
  const [showHub, setShowHub] = usePersistedCollapse("hub", false);
  const [showWsNetwork, setShowWsNetwork] = usePersistedCollapse("wsNetwork", false);
  const [showFirewall, setShowFirewall] = usePersistedCollapse("firewall", false);
  const [showEncryption, setShowEncryption] = usePersistedCollapse("encryption", false);
  const createNewVpc = formValues["create_new_vpc"] !== false && formValues["create_new_vpc"] !== "false";
  const isSraTemplate = selectedTemplate?.id?.includes("sra") ?? false;
  const isAzureSra = selectedTemplate?.id === "azure-sra";
  const skipsCatalogScreen = selectedTemplate?.id === "gcp-sra";
  const isAzurePl = selectedTemplate?.id === "azure-pl-sts";
  const isAzureSimple = selectedCloud === CLOUDS.AZURE && !isAzureSra && !isAzurePl;

  const [resourceConflicts, setResourceConflicts] = useState<ResourceNameConflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [checkingNames, setCheckingNames] = useState(false);

  const proceedAfterCheck = useCallback(() => {
    if (skipsCatalogScreen) {
      startDeploymentWizard();
    } else {
      setScreen("unity-catalog-config");
    }
  }, [skipsCatalogScreen, startDeploymentWizard, setScreen]);

  const waitForPaint = () => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const onContinue = useCallback(() => {
    const namesToCheck: string[] = [];

    if (isAzureSra) {
      if (formValues.create_hub === true || formValues.create_hub === "true") {
        const hubSuffix = formValues.hub_resource_suffix || formValues.resource_suffix || "";
        if (hubSuffix) namesToCheck.push(`rg-${hubSuffix}`);
      }
      if (formValues.create_workspace_resource_group === true || formValues.create_workspace_resource_group === "true") {
        const suffix = formValues.resource_suffix || "";
        if (suffix) namesToCheck.push(`rg-${suffix}`);
      }
    } else if (isAzurePl) {
      const createNew = formValues.create_data_plane_resource_group;
      if (createNew === true || createNew === "true") {
        const rgName = formValues.resource_group_name as string;
        if (rgName) namesToCheck.push(rgName);
      }
    } else if (isAzureSimple) {
      const createNew = formValues.create_new_resource_group;
      if (createNew === true || createNew === "true") {
        const rgName = formValues.resource_group_name as string;
        if (rgName) namesToCheck.push(rgName);
      }
    }

    if (namesToCheck.length === 0) {
      proceedAfterCheck();
      return;
    }

    setCheckingNames(true);

    setTimeout(async () => {
      await waitForPaint();
      try {
        const isSp = azure.authMode === "service_principal"
          && credentials.azure_client_id
          && credentials.azure_client_secret;

        const conflicts = isSp
          ? await invoke<ResourceNameConflict[]>("check_resource_names_available_sp", {
              credentials: { ...credentials, cloud: selectedCloud },
              names: namesToCheck,
            })
          : await invoke<ResourceNameConflict[]>("check_resource_names_available", {
              subscriptionId: credentials.azure_subscription_id || "",
              names: namesToCheck,
            });

        const currentTagValue = tagPairs.find(t => t.key === "databricks_deployer_template")?.value || "";
        const dangerous = conflicts.filter(c =>
          !c.deployer_tag_value || c.deployer_tag_value !== currentTagValue
        );
        if (dangerous.length > 0) {
          setResourceConflicts(dangerous);
          setShowConflictDialog(true);
        } else {
          proceedAfterCheck();
        }
      } catch (e) {
        console.warn("Resource name pre-flight check failed, proceeding anyway:", e);
        proceedAfterCheck();
      } finally {
        setCheckingNames(false);
      }
    }, 0);
  }, [isAzureSra, isAzureSimple, formValues, credentials, selectedCloud, azure.authMode, tagPairs, proceedAfterCheck]);
  const onBack = goBack;
  
  const handleFormChange = (name: string, value: string | boolean | number | string[]) => {
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
      if (name === "cidr" && selectedCloud === CLOUDS.AZURE && typeof value === "string") {
        const subnets = computeSubnets(value);
        if (subnets) {
          updated["subnet_public_cidr"] = subnets.publicCidr;
          updated["subnet_private_cidr"] = subnets.privateCidr;
        }
      }
      // Auto-fill subnets when VNet CIDR changes (Azure PL)
      if (name === "cidr_dp" && selectedCloud === CLOUDS.AZURE && typeof value === "string") {
        const plSubnets = computeAzurePlSubnets(value);
        if (plSubnets) {
          updated["subnet_workspace_cidrs_0"] = plSubnets.publicCidr;
          updated["subnet_workspace_cidrs_1"] = plSubnets.privateCidr;
          updated["subnet_private_endpoint_cidr"] = plSubnets.privateEndpointCidr;
        }
      }
      // Auto-fill subnets when VPC CIDR changes (AWS simple)
      if (name === "cidr_block" && selectedCloud === CLOUDS.AWS && typeof value === "string") {
        const subnets = computeAwsSubnets(value);
        if (subnets) {
          updated["private_subnet_1_cidr"] = subnets.private1Cidr;
          updated["private_subnet_2_cidr"] = subnets.private2Cidr;
          updated["public_subnet_cidr"] = subnets.publicCidr;
        }
      }
      // Auto-fill subnets when VPC CIDR changes (AWS SRA)
      if (name === "vpc_cidr_range" && selectedCloud === CLOUDS.AWS && typeof value === "string") {
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
      if (prev[index]?.key === "databricks_deployer_template") return prev;
      const updated = prev.filter((_, i) => i !== index);
      updateTagsFormValue(updated);
      return updated;
    });
  };

  // Check if the entered VNet CIDR overlaps with any existing Azure VNets
  const findVnetOverlap = (cidr: string) => {
    if (!parseCidr(cidr)) return null;
    for (const vnet of azureVnets) {
      for (const prefix of vnet.address_prefixes) {
        if (cidrsOverlap(cidr, prefix)) {
          return { vnetName: vnet.name, resourceGroup: vnet.resource_group, cidr: prefix };
        }
      }
    }
    return null;
  };

  const vnetOverlap = useMemo(() => {
    if (selectedCloud !== CLOUDS.AZURE || !formValues["cidr"]) return null;
    return findVnetOverlap(formValues["cidr"]);
  }, [selectedCloud, formValues["cidr"], azureVnets]);

  const vnetOverlapPl = useMemo(() => {
    if (selectedTemplate?.id !== "azure-pl-sts" || !formValues["cidr_dp"]) return null;
    return findVnetOverlap(formValues["cidr_dp"]);
  }, [selectedTemplate?.id, formValues["cidr_dp"], azureVnets]);

  const vnetOverlapSraHub = useMemo(() => {
    if (selectedTemplate?.id !== "azure-sra" || !formValues["hub_vnet_cidr"]) return null;
    return findVnetOverlap(formValues["hub_vnet_cidr"]);
  }, [selectedTemplate?.id, formValues["hub_vnet_cidr"], azureVnets]);

  const vnetOverlapSraWs = useMemo(() => {
    if (selectedTemplate?.id !== "azure-sra" || !formValues["workspace_vnet__cidr"]) return null;
    return findVnetOverlap(formValues["workspace_vnet__cidr"]);
  }, [selectedTemplate?.id, formValues["workspace_vnet__cidr"], azureVnets]);

  const subnetOverlap = useMemo(() => {
    if (selectedCloud !== CLOUDS.AZURE) return false;
    const pub = formValues["subnet_public_cidr"];
    const priv = formValues["subnet_private_cidr"];
    if (!pub || !priv || !parseCidr(pub) || !parseCidr(priv)) return false;
    return cidrsOverlap(pub, priv);
  }, [selectedCloud, formValues["subnet_public_cidr"], formValues["subnet_private_cidr"]]);

  const sraVnetOverlap = useMemo(() => {
    if (selectedTemplate?.id !== "azure-sra") return false;
    const hub = formValues["hub_vnet_cidr"];
    const ws = formValues["workspace_vnet__cidr"];
    if (!hub || !ws || !parseCidr(hub) || !parseCidr(ws)) return false;
    return cidrsOverlap(hub, ws);
  }, [selectedTemplate?.id, formValues["hub_vnet_cidr"], formValues["workspace_vnet__cidr"]]);

  const findVpcOverlap = (cidr: string) => {
    if (!parseCidr(cidr)) return null;
    for (const vpc of awsVpcs) {
      if (cidrsOverlap(cidr, vpc.cidr_block)) {
        return { vpcId: vpc.vpc_id, name: vpc.name, cidr: vpc.cidr_block };
      }
    }
    return null;
  };

  const vpcOverlap = useMemo(() => {
    if (selectedCloud !== CLOUDS.AWS || !formValues["cidr_block"]) return null;
    return findVpcOverlap(formValues["cidr_block"]);
  }, [selectedCloud, formValues["cidr_block"], awsVpcs]);

  const vpcOverlapSra = useMemo(() => {
    if (selectedTemplate?.id !== "aws-sra" || !formValues["vpc_cidr_range"]) return null;
    return findVpcOverlap(formValues["vpc_cidr_range"]);
  }, [selectedTemplate?.id, formValues["vpc_cidr_range"], awsVpcs]);

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
  if (isAzurePl) {
    conditionallyRequired.add("resource_group_name");
    conditionallyRequired.add("cidr_dp");
    conditionallyRequired.add("subnet_workspace_cidrs_0");
    conditionallyRequired.add("subnet_workspace_cidrs_1");
    conditionallyRequired.add("subnet_private_endpoint_cidr");
  } else if (selectedCloud === CLOUDS.AZURE && !isAzureSra) {
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
      conditionallyRequired.add("custom_workspace_vpce_id");
      conditionallyRequired.add("custom_relay_vpce_id");
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
      conditionallyRequired.add("existing_ncc_id");
      conditionallyRequired.add("existing_ncc_name");
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

    const storageVal = formValues["root_storage_name"];
    if (storageVal && typeof storageVal === "string") {
      if (!/^[a-z0-9]+$/.test(storageVal)) {
        fieldErrors["root_storage_name"] = "Only lowercase letters and numbers allowed (no hyphens or special characters).";
      } else if (storageVal.length < 3 || storageVal.length > 24) {
        fieldErrors["root_storage_name"] = "Must be between 3 and 24 characters.";
      }
    }

    const wsName = formValues["workspace_name"];
    if (wsName && typeof wsName === "string") {
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(wsName)) {
        fieldErrors["workspace_name"] = "Must start and end with a letter or number, contain only lowercase letters, numbers, and hyphens";
      } else if (wsName.length < 3 || wsName.length > 45) {
        fieldErrors["workspace_name"] = "Must be between 3 and 45 characters";
      } else if (/--/.test(wsName)) {
        fieldErrors["workspace_name"] = "Cannot contain consecutive hyphens";
      }
    }

    const resPrefixVal = formValues["resource_prefix"];
    if (resPrefixVal && typeof resPrefixVal === "string") {
      if (!/^[a-z0-9.\-]+$/.test(resPrefixVal)) {
        fieldErrors["resource_prefix"] = "Only lowercase letters, numbers, hyphens, and dots allowed.";
      } else if (resPrefixVal.length > 26) {
        fieldErrors["resource_prefix"] = "Must be 26 characters or fewer.";
      }
    }

    const adminEmail = formValues["admin_user"];
    if (adminEmail && typeof adminEmail === "string") {
      if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(adminEmail)) {
        fieldErrors["admin_user"] = "Must be a valid email address.";
      }
    }

    // Azure SRA: CIDR range blocking errors (Terraform modules hard-fail outside /16-/24)
    if (isAzureSra) {
      const hubCidr = formValues["hub_vnet_cidr"];
      if (hubCidr && typeof hubCidr === "string") {
        const p = parseCidr(hubCidr);
        if (p && (p.prefixLen < 16 || p.prefixLen > 24)) {
          fieldErrors["hub_vnet_cidr"] = `CIDR prefix /${p.prefixLen} is outside the allowed /16–/24 range.`;
        }
      }
      const wsCidr = formValues["workspace_vnet__cidr"];
      if (wsCidr && typeof wsCidr === "string") {
        const p = parseCidr(wsCidr);
        if (p && (p.prefixLen < 16 || p.prefixLen > 24)) {
          fieldErrors["workspace_vnet__cidr"] = `CIDR prefix /${p.prefixLen} is outside the allowed /16–/24 range.`;
        }
      }
      // Hub/workspace overlap
      if (hubCidr && wsCidr && parseCidr(hubCidr) && parseCidr(wsCidr) && cidrsOverlap(hubCidr, wsCidr)) {
        if (!fieldErrors["hub_vnet_cidr"])
          fieldErrors["hub_vnet_cidr"] = "Hub VNet CIDR overlaps with the Workspace VNet CIDR. They must be non-overlapping.";
        if (!fieldErrors["workspace_vnet__cidr"])
          fieldErrors["workspace_vnet__cidr"] = "Workspace VNet CIDR overlaps with the Hub VNet CIDR. They must be non-overlapping.";
      }
    }

    // Azure SRA: compliance standards require compliance_security_profile_enabled
    if (isAzureSra) {
      const cspEnabled = formValues["wsc__csp_enabled"] === true || formValues["wsc__csp_enabled"] === "true";
      const cspStandards = (() => {
        const val = formValues["wsc__csp_standards"];
        if (Array.isArray(val)) return val;
        if (typeof val === "string" && val.trim()) {
          try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
        }
        return [];
      })();
      if (cspStandards.length > 0 && !cspEnabled) {
        fieldErrors["wsc__csp_enabled"] = "Compliance standards are selected but Compliance Security Profile is disabled. Enable it or clear the selected standards.";
      }
    }

    // Azure SRA: SAT service principal paired fields
    if (isAzureSra) {
      const spClientId = (formValues["sat_sp__client_id"] || "") as string;
      const spClientSecret = (formValues["sat_sp__client_secret"] || "") as string;
      if ((spClientId && !spClientSecret) || (!spClientId && spClientSecret)) {
        const missingField = spClientId ? "sat_sp__client_secret" : "sat_sp__client_id";
        fieldErrors[missingField] = "Both client_id and client_secret must be provided together, or both left empty.";
      }
    }

    // Azure SRA: SAT FQDN requirements (blocking when SAT is enabled)
    if (isAzureSra) {
      const satEnabled = formValues["sat__enabled"] === true || formValues["sat__enabled"] === "true";
      if (satEnabled) {
        const currentUrls: string[] = (() => {
          const val = formValues["allowed_fqdns"];
          if (Array.isArray(val)) return val;
          if (typeof val === "string" && val.trim()) {
            try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
          }
          return [];
        })();
        const azureMgmtUrls = ["management.azure.com", "login.microsoftonline.com"];
        const pythonUrls = ["python.org", "*.python.org", "pypi.org", "*.pypi.org", "pythonhosted.org", "*.pythonhosted.org"];
        const missingAzure = azureMgmtUrls.some(u => !currentUrls.includes(u));
        const missingPython = pythonUrls.some(u => !currentUrls.includes(u));
        if (missingAzure || missingPython) {
          const groups = [missingAzure && "Azure Management", missingPython && "Python Packages"].filter(Boolean);
          fieldErrors["allowed_fqdns"] = `SAT is enabled — missing required FQDN groups: ${groups.join(", ")}. Deployment will fail without these.`;
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

  const sections = useMemo(
    () => groupVariablesBySection(variables, selectedTemplate?.id),
    [variables, selectedTemplate?.id],
  );

  const sectionErrorCounts = useMemo(() => {
    if (!formSubmitAttempted) return {};
    const counts: Record<string, number> = {};
    for (const [secName, secVars] of Object.entries(sections)) {
      let count = 0;
      for (const v of secVars) {
        if (hiddenFields.has(v.name)) continue;
        if (formValidation.missingFields.includes(v.name)) count++;
        if (formValidation.fieldErrors[v.name]) count++;
        const od = OBJECT_FIELD_DECOMPOSITION[v.name];
        if (od) {
          for (const sf of od) {
            if (formValidation.fieldErrors[sf.key]) count++;
          }
        }
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
  }, [formSubmitAttempted, sections, hiddenFields, formValidation, formValues, allRequiredFields]);

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

  const isBoolField = (v: TerraformVariable) =>
    v.var_type.includes("bool") || KNOWN_BOOLEANS.has(v.name);

  const sectionToggle: Record<string, [boolean, (v: boolean) => void]> = {
    "Advanced: Network Configuration": [showAdvanced, setShowAdvanced],
    "Hub Infrastructure": [showHub, setShowHub],
    "Workspace Network": [showWsNetwork, setShowWsNetwork],
    "Firewall Rules": [showFirewall, setShowFirewall],
    "Encryption": [showEncryption, setShowEncryption],
    "Security & Compliance": [showSecurity, setShowSecurity],
    "Metastore & Catalog": [showMetastore, setShowMetastore],
    "Additional Settings": [showAdditional, setShowAdditional],
    "Other Configuration": [showOther, setShowOther],
    "Tags": [showTags, setShowTags],
  };

  const sectionSubtitles: Record<string, string> = {
    "Advanced: Network Configuration": selectedCloud === CLOUDS.AZURE && !isSraTemplate
      ? "VNet and subnet configuration. Defaults are pre-filled — review if you have specific networking requirements."
      : "Network settings have sensible defaults. Modify only if you have specific requirements.",
    "Hub Infrastructure": "Azure hub VNet, firewall, and CMK infrastructure. Toggle off 'Create Hub & Account Resources' below if you already have hub infrastructure deployed.",
    "Workspace Network": "Workspace VNet and resource group configuration.",
    "Firewall Rules": "Control which internet domains workspaces can access (applies to both classic and serverless compute).",
    "Encryption": "Customer-managed key (CMK) encryption for managed disks and services.",
    "Security & Compliance": "Security profiles, encryption, and compliance settings.",
    "Metastore & Catalog": "Configure Unity Catalog metastore and workspace catalog.",
    "Additional Settings": "These settings have sensible defaults. Expand to customize.",
    "Other Configuration": "Additional configuration options.",
    "Tags": "Key-value pairs to tag all created resources for cost tracking and organization.",
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
                    handleFormChange(sf.key, next);
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
          <option value="1">Large — 2 subnets, max compute capacity</option>
          <option value="2">Balanced — 4 subnets (recommended)</option>
          <option value="3">Small — 8 subnets, less compute per subnet</option>
          <option value="4">Smallest — 16 subnets, least compute per subnet</option>
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
          className={formValidation.fieldErrors[sf.key] ? "input-error" : ""}
        />
      )}
      {formValidation.fieldErrors[sf.key] ? (
        <div className="help-text" style={{ color: "#e74c3c" }}>{formValidation.fieldErrors[sf.key]}</div>
      ) : (
        <div className="help-text">{sf.description}</div>
      )}
      {sf.key === "workspace_vnet__new_bits" && (() => {
        const cidrVal = formValues["workspace_vnet__cidr"];
        if (!cidrVal || typeof cidrVal !== "string") return null;
        const p = parseCidr(cidrVal);
        if (!p || p.prefixLen < 16 || p.prefixLen > 24) return null;
        const nb = Number(formValues[sf.key] ?? 2);
        const subnetPrefix = p.prefixLen + nb;
        const nodes = getUsableNodes(subnetPrefix);
        return (
          <div className="help-text" style={{ color: "#4ec9b0" }}>
            {Math.pow(2, nb)} subnets · each /{subnetPrefix}, up to ~{nodes.toLocaleString()} nodes
          </div>
        );
      })()}
      {sf.key === "workspace_vnet__cidr" && formValidation.fieldErrors["workspace_vnet__cidr"] && (
        <div className="help-text" style={{ color: "#e74c3c" }}>
          {formValidation.fieldErrors["workspace_vnet__cidr"]}
        </div>
      )}
      {sf.key === "workspace_vnet__cidr" && !formValidation.fieldErrors["workspace_vnet__cidr"] && (() => {
        const val = formValues[sf.key];
        if (!val || typeof val !== "string") return null;
        const p = parseCidr(val);
        if (!p) return null;
        if (p.prefixLen < 16 || p.prefixLen > 24)
          return <div className="help-text" style={{ color: "#ffb347" }}>⚠ Workspace VNet prefix /{p.prefixLen} is outside the recommended /16–/24 range.</div>;
        return null;
      })()}
      {sf.key === "workspace_vnet__cidr" && !formValidation.fieldErrors["workspace_vnet__cidr"] && sraVnetOverlap && (
        <div className="help-text" style={{ color: "#ffb347" }}>
          ⚠ Workspace VNet CIDR overlaps with the Hub VNet CIDR. They must be non-overlapping ranges.
        </div>
      )}
      {sf.key === "workspace_vnet__cidr" && !formValidation.fieldErrors["workspace_vnet__cidr"] && vnetOverlapSraWs && (
        <div className="help-text" style={{ color: "#ffb347" }}>
          ⚠ This range overlaps with existing VNet &quot;{vnetOverlapSraWs.vnetName}&quot; ({vnetOverlapSraWs.cidr}) in {vnetOverlapSraWs.resourceGroup}
        </div>
      )}
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
                <LinkifyText text={VARIABLE_DESCRIPTION_OVERRIDES[variable.name] || variable.description} />
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

    if ((variable.name === "create_new_vnet" || variable.name === "create_data_plane_resource_group") && isBoolField(variable)) {
      return (
        <div key={variable.name} className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label className="checkbox-label" style={{ fontSize: "1em" }}>
            <input
              type="checkbox"
              checked={formValues[variable.name] === "true" || formValues[variable.name] === true}
              onChange={(e) => handleFormChange(variable.name, e.target.checked)}
            />
            {formatVariableName(variable.name)}
          </label>
        </div>
      );
    }

    return (
      <div key={variable.name} className="form-group" style={variable.name === "tags" ? { gridColumn: "1 / -1" } : undefined}>
        <label style={variable.name === "subnets_service_endpoints" ? { display: "flex", alignItems: "center", gap: "6px" } : undefined}>
          {formatVariableName(variable.name)}
          {((variable.required && !variable.default) || allRequiredFields.has(variable.name)) && " *"}
          {variable.name === "subnets_service_endpoints" && (
            <span className="cidr-tooltip-wrapper">
              <span className="cidr-tooltip-icon">?</span>
              <span className="cidr-tooltip" style={{ width: "320px", whiteSpace: "normal" }}>
                <span className="cidr-tooltip-title">What are Service Endpoints?</span>
                Service endpoints route traffic from your VNet to Azure services (e.g. Storage, Key Vault) directly over Microsoft's backbone network instead of the public internet. This improves security and performance. You can then restrict those Azure services to only accept traffic from your Databricks subnets. Optional for most deployments.
              </span>
            </span>
          )}
        </label>
        {isBoolField(variable) ? (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formValues[variable.name] === "true" || formValues[variable.name] === true}
              onChange={(e) => handleFormChange(variable.name, e.target.checked)}
            />
            {variable.name === "audit_log_delivery_exists" ? "Yes (will skip creating a new one)" : "Enabled"}
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
        ) : variable.name === "resource_group_name" && azureResourceGroups.length > 0 && (selectedTemplate?.id === "azure-simple" || isAzurePl) ? (
          <>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={formValues[variable.name] || ""}
              onChange={(e) => {
                const val = e.target.value;
                const isExisting = azureResourceGroups.some(rg => rg.name === val);
                setFormValues(prev => ({
                  ...prev,
                  [variable.name]: val,
                  ...(isAzurePl
                    ? {
                        create_data_plane_resource_group: !isExisting,
                        existing_data_plane_resource_group_name: isExisting ? val : "",
                      }
                    : {
                        vnet_resource_group_name: val,
                        create_new_resource_group: !isExisting,
                      }),
                }));
              }}
              placeholder="Type to filter or enter new resource group name"
              className={formSubmitAttempted && formValidation.missingFields.includes(variable.name) ? "input-error" : ""}
            />
            {(() => {
              const filterVal = (formValues[variable.name] as string || "").toLowerCase();
              const filtered = azureResourceGroups.filter(rg =>
                rg.name.toLowerCase().includes(filterVal) || rg.location.toLowerCase().includes(filterVal)
              );
              const exactMatch = azureResourceGroups.some(rg => rg.name === formValues[variable.name]);
              if (filtered.length === 0 || exactMatch) return null;
              return (
                <div className="rg-dropdown">
                  {filtered.map((rg) => (
                    <div
                      key={rg.name}
                      className="rg-dropdown-item"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setFormValues(prev => ({
                          ...prev,
                          [variable.name]: rg.name,
                          ...(isAzurePl
                            ? {
                                create_data_plane_resource_group: false,
                                existing_data_plane_resource_group_name: rg.name,
                              }
                            : {
                                vnet_resource_group_name: rg.name,
                                create_new_resource_group: false,
                              }),
                        }));
                      }}
                    >
                      {rg.name} <span style={{ color: "var(--text-muted)" }}>({rg.location})</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {formValues[variable.name] && !azureResourceGroups.some(rg => rg.name === formValues[variable.name]) && (
              <div className="help-text" style={{ color: "#4ec9b0", marginTop: "4px" }}>
                New resource group will be created
              </div>
            )}
          </>
        ) : variable.name === "existing_resource_group_name" && azureResourceGroups.length > 0 ? (
          <select
            value={azureResourceGroups.some(rg => rg.name === formValues[variable.name]) ? formValues[variable.name] : ""}
            onChange={(e) => {
              const val = e.target.value;
              setFormValues(prev => ({
                ...prev,
                [variable.name]: val,
                create_workspace_resource_group: val === "" ? true : false,
              }));
            }}
            className={formSubmitAttempted && formValidation.missingFields.includes(variable.name) ? "input-error" : ""}
          >
            <option value="">{`Create new (rg-${formValues["resource_suffix"] || "<resource_suffix>"})`}</option>
            {azureResourceGroups.map((rg) => (
              <option key={rg.name} value={rg.name}>
                {rg.name} ({rg.location})
              </option>
            ))}
          </select>
        ) : variable.name === "existing_data_plane_resource_group_name" && azureResourceGroups.length > 0 ? (
          <select
            value={azureResourceGroups.some(rg => rg.name === formValues[variable.name]) ? formValues[variable.name] : ""}
            onChange={(e) => handleFormChange(variable.name, e.target.value)}
            className={formSubmitAttempted && formValidation.missingFields.includes(variable.name) ? "input-error" : ""}
          >
            <option value="">Select existing resource group</option>
            {azureResourceGroups.map((rg) => (
              <option key={rg.name} value={rg.name}>
                {rg.name} ({rg.location})
              </option>
            ))}
          </select>
        ) : variable.name === "allowed_fqdns" && FQDN_GROUPS[variable.name] ? (() => {
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
                If SAT is enabled, Azure Management and Python Packages are required.
              </div>
              {formValidation.fieldErrors["allowed_fqdns"] && (
                <div className="help-text" style={{ color: "#e74c3c", marginTop: "4px" }}>
                  {formValidation.fieldErrors["allowed_fqdns"]}
                </div>
              )}
              {!formValidation.fieldErrors["allowed_fqdns"] && (() => {
                const satEnabled = formValues["sat__enabled"] === true || formValues["sat__enabled"] === "true";
                if (!satEnabled) return null;
                const requiredGroups = groups.filter(g => g.id === "azure_mgmt" || g.id === "python");
                const missing = requiredGroups.filter(g => !isGroupChecked(g));
                if (missing.length === 0) return null;
                return (
                  <div className="help-text" style={{ color: "#ffb347", marginTop: "4px" }}>
                    ⚠ SAT is enabled — missing required FQDN groups: {missing.map(g => g.label).join(", ")}. Deployment will fail without these.
                  </div>
                );
              })()}
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
        })() : variable.name === "subnets_service_endpoints" ? (() => {
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
              {selected.map((ep, idx) => (
                <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "2px", alignItems: "center" }}>
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={ep}
                    onChange={(e) => {
                      const updated = [...selected];
                      updated[idx] = e.target.value;
                      handleFormChange(variable.name, updated.filter((v) => v !== ""));
                    }}
                    placeholder="e.g. Microsoft.Storage"
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={() => {
                    handleFormChange(variable.name, selected.filter((_, i) => i !== idx));
                  }}
                    style={{ background: "transparent", border: "1px solid #555", color: "#e74c3c",
                      borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "14px" }}
                    title="Remove endpoint">×</button>
                </div>
              ))}
              <button type="button" onClick={() => {
                handleFormChange(variable.name, [...selected, ""]);
              }}
                style={{ background: "transparent", border: "1px dashed #555", color: "#fff",
                    borderRadius: "4px", padding: "6px 16px", cursor: "pointer", fontSize: "13px", width: "100%" }}>
                + Add service endpoint
              </button>
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
            placeholder={PLACEHOLDER_OVERRIDES[variable.name] || variable.default || ""}
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
          <div className="help-text" style={isSubnetField ? { display: "flex", alignItems: "center", gap: "6px" } : undefined}>
            <LinkifyText text={VARIABLE_DESCRIPTION_OVERRIDES[variable.name] || variable.description} />
            {isSubnetField && fieldParsed && variable.name !== "public_subnet_cidr" && (
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
            )}
          </div>
        )}
        {variable.name === "cidr" && vnetOverlap && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ This range overlaps with existing VNet &quot;{vnetOverlap.vnetName}&quot; ({vnetOverlap.cidr}) in {vnetOverlap.resourceGroup}
          </div>
        )}
        {variable.name === "cidr_dp" && vnetOverlapPl && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ This range overlaps with existing VNet &quot;{vnetOverlapPl.vnetName}&quot; ({vnetOverlapPl.cidr}) in {vnetOverlapPl.resourceGroup}
          </div>
        )}
        {variable.name === "cidr_block" && vpcOverlap && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ This range overlaps with existing VPC{vpcOverlap.name ? ` "${vpcOverlap.name}"` : ""} ({vpcOverlap.cidr}) {vpcOverlap.vpcId}
          </div>
        )}
        {variable.name === "vpc_cidr_range" && vpcOverlapSra && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ This range overlaps with existing VPC{vpcOverlapSra.name ? ` "${vpcOverlapSra.name}"` : ""} ({vpcOverlapSra.cidr}) {vpcOverlapSra.vpcId}
          </div>
        )}
        {(variable.name === "subnet_public_cidr" || variable.name === "subnet_private_cidr") && subnetOverlap && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ Public and private subnet CIDRs overlap. They must be non-overlapping ranges within the VNet.
          </div>
        )}
        {variable.name === "hub_vnet_cidr" && !formValidation.fieldErrors["hub_vnet_cidr"] && sraVnetOverlap && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ Hub VNet CIDR overlaps with the Workspace VNet CIDR. They must be non-overlapping ranges.
          </div>
        )}
        {variable.name === "hub_vnet_cidr" && !formValidation.fieldErrors["hub_vnet_cidr"] && vnetOverlapSraHub && (
          <div className="help-text" style={{ color: "#ffb347" }}>
            ⚠ This range overlaps with existing VNet &quot;{vnetOverlapSraHub.vnetName}&quot; ({vnetOverlapSraHub.cidr}) in {vnetOverlapSraHub.resourceGroup}
          </div>
        )}
        {!formValidation.fieldErrors[variable.name] && (() => {
          const val = formValues[variable.name];
          if (!val || typeof val !== "string") return null;
          const p = parseCidr(val);
          if (!p) return null;
          let warn: string | null = null;
          if (variable.name === "cidr_block" && (p.prefixLen < 15 || p.prefixLen > 24))
            warn = `⚠ VPC prefix /${p.prefixLen} is outside the recommended /15–/24 range. Private subnets would be /${p.prefixLen + 2}, but Databricks requires /17–/26.`;
          else if (variable.name === "vpc_cidr_range" && (p.prefixLen < 15 || p.prefixLen > 24))
            warn = `⚠ VPC prefix /${p.prefixLen} is outside the recommended /15–/24 range. Private subnets should be /17–/26 for Databricks.`;
          else if ((variable.name === "cidr" || variable.name === "cidr_dp") && (p.prefixLen < 16 || p.prefixLen > 24))
            warn = `⚠ VNet prefix /${p.prefixLen} is outside the recommended /16–/24 range.`;
          else if ((variable.name === "subnet_public_cidr" || variable.name === "subnet_private_cidr") && p.prefixLen > 26)
            warn = `⚠ Subnet /${p.prefixLen} is smaller than the Databricks recommended minimum of /26.`;
          else if (variable.name === "hub_vnet_cidr" && (p.prefixLen < 16 || p.prefixLen > 24))
            warn = `⚠ Hub VNet prefix /${p.prefixLen} is outside the recommended /16–/24 range.`;
          else if (variable.name === "subnet_cidr" && (p.prefixLen < 16 || p.prefixLen > 26))
            warn = `⚠ Subnet prefix /${p.prefixLen} is outside the recommended /16–/26 range. Databricks recommends /19–/25 for optimal sizing.`;
          if (!warn) return null;
          return <div className="help-text" style={{ color: "#ffb347" }}>{warn}</div>;
        })()}
      </div>
    );
  };

  const fieldGroupMap = useMemo(() => {
    const map: Record<string, typeof FIELD_GROUPS[number]> = {};
    for (const group of FIELD_GROUPS) {
      for (const field of group.fields) map[field] = group;
    }
    return map;
  }, []);

  const renderSectionFields = (vars: TerraformVariable[]) => {
    const rendered: React.ReactNode[] = [];
    const groupsRendered = new Set<string>();

    for (const v of vars) {
      const group = fieldGroupMap[v.name];
      if (group) {
        if (groupsRendered.has(group.label)) continue;
        groupsRendered.add(group.label);
        const groupVars = vars.filter(gv => group.fields.includes(gv.name));
        if (groupVars.length === 0) continue;
        rendered.push(
          <div key={`group-${group.label}`} style={{ gridColumn: "1 / -1" }}>
            <div style={{
              padding: "12px 16px",
              background: "rgba(255,255,255,0.03)",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: "4px",
            }}>
              <h4 style={{ margin: "0 0 4px 0", fontSize: "0.95em", color: "#e0e0e0" }}>
                {group.label}
              </h4>
              <div className="help-text" style={{ marginBottom: "12px" }}>
                {group.description}
              </div>
              <div className="two-column">
                {groupVars.map(renderField)}
              </div>
            </div>
          </div>
        );
      } else {
        rendered.push(renderField(v));
      }
    }
    return rendered;
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

      {checkingNames && (
        <Alert type="loading">Checking resource availability...</Alert>
      )}

      <form onSubmit={(e) => e.preventDefault()} style={{ opacity: checkingNames ? 0.6 : 1, pointerEvents: checkingNames ? "none" : undefined }}>
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
                        {tagPairs.map((tag, index) => {
                          const isDefault = tag.key === "databricks_deployer_template";
                          return (
                            <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                              <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                                value={tag.key} onChange={(e) => handleTagChange(index, "key", e.target.value)}
                                placeholder="Key (e.g., Environment)" style={{ flex: 1, ...(isDefault ? { opacity: 0.6 } : {}) }}
                                disabled={isDefault} />
                              <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                                value={tag.value} onChange={(e) => handleTagChange(index, "value", e.target.value)}
                                placeholder="Value (e.g., Production)" style={{ flex: 1, ...(isDefault ? { opacity: 0.6 } : {}) }}
                                disabled={isDefault} />
                              {isDefault ? (
                                <span style={{ width: "34px", textAlign: "center", fontSize: "14px", color: "#555" }}
                                  title="Default tag (read-only)">🔒</span>
                              ) : (
                                <button type="button" onClick={() => removeTag(index)}
                                  style={{ background: "transparent", border: "1px solid #555", color: "#e74c3c",
                                    borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "14px" }}
                                  title="Remove tag">×</button>
                              )}
                            </div>
                          );
                        })}
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
                      {renderSectionFields(visibleVars)}
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
            disabled={loading || checkingNames}
          >
            {loading || checkingNames ? (
              <>
                <span className="spinner" />
                {checkingNames ? "Checking resources..." : "Preparing..."}
              </>
            ) : (
              skipsCatalogScreen ? "Create Workspace →" : "Continue →"
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

      {showConflictDialog && (
        <div className="confirm-overlay" onClick={() => setShowConflictDialog(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3>Resource Name Conflict Detected</h3>
            <p>
              The following resource names already exist in your subscription:
            </p>
            <ul style={{ margin: "12px 0", paddingLeft: "20px" }}>
              {resourceConflicts.map(c => (
                <li key={c.name} style={{ marginBottom: "4px" }}>
                  <code>{c.name}</code>{" "}
                  <span style={{ color: "var(--text-muted)" }}>({c.resource_type})</span>
                </li>
              ))}
            </ul>
            <p style={{ fontSize: "0.9em", color: "var(--text-muted)" }}>
              If you continue, Terraform will attempt to import and manage these resources. This could modify or interfere with existing infrastructure.
            </p>
            <div className="confirm-dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowConflictDialog(false)}>
                Go Back
              </button>
              <button className="btn btn-danger" onClick={() => {
                setShowConflictDialog(false);
                proceedAfterCheck();
              }}>
                Continue Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
