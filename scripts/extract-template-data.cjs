#!/usr/bin/env node
/**
 * Extracts template metadata, variable schemas, and .tf file contents
 * from src-tauri/templates/ into docs/template-builder/template-data.js
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'src-tauri', 'templates');
const OUTPUT_FILE = path.join(__dirname, '..', 'docs', 'template-builder', 'template-data.js');

const TEMPLATE_CATALOG = [
  {
    id: 'aws-simple',
    name: 'AWS Standard BYOVPC',
    cloud: 'aws',
    description: 'Secure baseline deployment with customer-managed VPC',
    features: [
      'Customer-managed VPC (BYOVPC)',
      'Security groups for traffic control',
      'Private and public subnets',
      'IAM roles and policies',
      'S3 bucket configuration',
      'Unity Catalog integration',
    ],
  },
  {
    id: 'azure-simple',
    name: 'Azure Standard VNet',
    cloud: 'azure',
    description: 'Secure baseline deployment with VNet injection',
    features: [
      'Private networking with VNet injection',
      'Network security groups',
      'NAT gateway for outbound access',
      'Azure resource group isolation',
      'Production-ready security',
      'Unity Catalog integration',
    ],
  },
  {
    id: 'azure-pl-sts',
    name: 'Azure Private Link',
    cloud: 'azure',
    description: 'Private Link workspace with backend and DBFS private endpoints, DNS zones, and serverless NCC',
    features: [
      'Backend Private Link (control plane)',
      'DBFS Private Endpoint',
      'Private DNS zones',
      'Serverless NCC with Private Link',
      'VNet injection with dedicated subnets',
    ],
  },
  {
    id: 'gcp-simple',
    name: 'GCP Standard BYOVPC',
    cloud: 'gcp',
    description: 'Secure baseline deployment with customer-managed VPC',
    features: [
      'Customer-managed VPC (BYOVPC)',
      'Cloud NAT for outbound access',
      'Service account authentication',
      'Metastore auto-detection/creation',
      'Production-ready security',
      'Unity Catalog integration',
    ],
  },
  {
    id: 'aws-sra',
    name: 'AWS Security Reference Architecture',
    cloud: 'aws',
    description: 'Enterprise-grade security with PrivateLink, CMK encryption, and compliance controls',
    features: [
      'VPC with PrivateLink (no public access)',
      'Customer-managed keys (CMK) encryption',
      'Security Analysis Tool (SAT)',
      'Compliance Security Profile',
      'Network connectivity configuration',
      'Audit log delivery',
      'Unity Catalog with isolated catalogs',
    ],
  },
  {
    id: 'azure-sra',
    name: 'Azure Security Reference Architecture',
    cloud: 'azure',
    description: 'Enterprise-grade hub-spoke deployment with Private Endpoints and CMK encryption',
    features: [
      'Hub-spoke VNet architecture',
      'Private Endpoints (no public access)',
      'Customer-managed keys (CMK) encryption',
      'Azure Firewall with FQDN filtering',
      'Security Analysis Tool (SAT)',
      'Network Connectivity Configuration (NCC)',
      'Unity Catalog with isolated catalogs',
    ],
  },
  {
    id: 'gcp-sra',
    name: 'GCP Security Reference Architecture',
    cloud: 'gcp',
    description: 'Enterprise-grade security with Private Service Connect, CMEK, and hardened firewall',
    features: [
      'Private Service Connect (PSC)',
      'Customer-managed encryption keys (CMEK)',
      'Hardened VPC firewall rules',
      'IP access list restrictions',
      'Private access settings',
      'Service account impersonation',
      'Modular workspace deployment',
    ],
  },
];

const INTERNAL_VARIABLES = [
  'gcp_auth_method',
  'google_credentials_json',
  'hub_workspace_url_override',
  'spoke_workspace_url_override',
  'workspace_url_override',
  'workspace_sku',
  'az_subscription',
];

function parseVariablesTf(content) {
  const variables = [];
  let currentVar = null;
  let inVariableBlock = false;
  let braceCount = 0;
  let currentDescription = '';
  let currentType = 'string';
  let currentDefault = null;
  let isSensitive = false;
  let currentValidation = null;
  let inMultilineDefault = false;
  let defaultBraceCount = 0;
  let defaultBracketCount = 0;
  let multilineDefaultBuffer = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!inVariableBlock && trimmed.startsWith('variable ') && trimmed.includes('{')) {
      inVariableBlock = true;
      braceCount = 1;
      const nameMatch = trimmed.match(/variable\s+"([^"]+)"/);
      if (nameMatch) {
        currentVar = { name: nameMatch[1] };
      }
      currentDescription = '';
      currentType = 'string';
      currentDefault = null;
      isSensitive = false;
      currentValidation = null;
      inMultilineDefault = false;
      defaultBraceCount = 0;
      defaultBracketCount = 0;
      multilineDefaultBuffer = '';
      continue;
    }

    if (inVariableBlock) {
      if (inMultilineDefault) {
        multilineDefaultBuffer += trimmed + ' ';
        defaultBraceCount += (trimmed.match(/{/g) || []).length;
        defaultBraceCount -= (trimmed.match(/}/g) || []).length;
        defaultBracketCount += (trimmed.match(/\[/g) || []).length;
        defaultBracketCount -= (trimmed.match(/]/g) || []).length;

        if (defaultBraceCount <= 0 && defaultBracketCount <= 0) {
          inMultilineDefault = false;
          currentDefault = multilineDefaultBuffer.trim();
        }

        braceCount += (trimmed.match(/{/g) || []).length;
        braceCount -= (trimmed.match(/}/g) || []).length;
      } else {
        braceCount += (trimmed.match(/{/g) || []).length;
        braceCount -= (trimmed.match(/}/g) || []).length;

        if (braceCount >= 1) {
          if (trimmed.startsWith('description')) {
            const val = extractStringValue(trimmed);
            if (val !== null) currentDescription = val;
          } else if (trimmed.startsWith('type')) {
            const val = extractTypeValue(trimmed);
            if (val !== null) currentType = val;
          } else if (trimmed.startsWith('default')) {
            const afterEq = (trimmed.split('=').slice(1).join('=') || '').trim();
            if (afterEq.startsWith('{') || afterEq.startsWith('[')) {
              const openBraces = (afterEq.match(/{/g) || []).length;
              const closeBraces = (afterEq.match(/}/g) || []).length;
              const openBrackets = (afterEq.match(/\[/g) || []).length;
              const closeBrackets = (afterEq.match(/]/g) || []).length;
              if (openBraces > closeBraces || openBrackets > closeBrackets) {
                inMultilineDefault = true;
                defaultBraceCount = openBraces - closeBraces;
                defaultBracketCount = openBrackets - closeBrackets;
                multilineDefaultBuffer = afterEq + ' ';
              } else {
                currentDefault = afterEq;
              }
            } else {
              currentDefault = extractDefaultValue(trimmed);
            }
          } else if (trimmed.startsWith('sensitive') && trimmed.includes('true')) {
            isSensitive = true;
          } else if (trimmed.startsWith('condition')) {
            const val = extractStringValue(line);
            if (val !== null) currentValidation = val;
          }
        }
      }

      if (braceCount === 0 && !inMultilineDefault) {
        if (currentVar) {
          variables.push({
            name: currentVar.name,
            description: currentDescription,
            var_type: currentType,
            default: currentDefault,
            required: currentDefault === null,
            sensitive: isSensitive,
            validation: currentValidation,
          });
          currentVar = null;
        }
        inVariableBlock = false;
      }
    }
  }
  return variables;
}

function extractStringValue(line) {
  const start = line.indexOf('"');
  if (start === -1) return null;
  const end = line.lastIndexOf('"');
  if (end <= start) return null;
  return line.substring(start + 1, end);
}

function extractTypeValue(line) {
  const idx = line.indexOf('=');
  if (idx === -1) return null;
  return line.substring(idx + 1).trim();
}

function extractDefaultValue(line) {
  const idx = line.indexOf('=');
  if (idx === -1) return null;
  const valuePart = line.substring(idx + 1).trim();
  if (valuePart.startsWith('"') && valuePart.endsWith('"')) {
    return valuePart.slice(1, -1);
  }
  if (valuePart && valuePart !== '{' && valuePart !== '[') {
    return valuePart;
  }
  return null;
}

function collectTfFiles(templateDir, basePath = '') {
  const files = [];
  const entries = fs.readdirSync(templateDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(templateDir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '.terraform' || entry.name === 'target') continue;
      files.push(...collectTfFiles(fullPath, relativePath));
    } else if (entry.name.endsWith('.tf')) {
      files.push({
        path: relativePath,
        content: fs.readFileSync(fullPath, 'utf-8'),
      });
    }
  }
  return files;
}

// Build the data
const templateData = {};
for (const tmpl of TEMPLATE_CATALOG) {
  const templateDir = path.join(TEMPLATES_DIR, tmpl.id);
  if (!fs.existsSync(templateDir)) {
    console.warn(`Template directory not found: ${tmpl.id}`);
    continue;
  }

  const variablesPath = path.join(templateDir, 'variables.tf');
  let variables = [];
  if (fs.existsSync(variablesPath)) {
    const content = fs.readFileSync(variablesPath, 'utf-8');
    const allVars = parseVariablesTf(content);
    variables = allVars.filter(v => !INTERNAL_VARIABLES.includes(v.name));
  }

  const tfFiles = collectTfFiles(templateDir);

  templateData[tmpl.id] = {
    ...tmpl,
    variables,
    files: tfFiles,
  };
}

const output = `// Auto-generated by scripts/extract-template-data.js
// Do not edit manually. Re-run the script when templates change.
window.TEMPLATE_DATA = ${JSON.stringify(templateData, null, 2)};
`;

fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');

const stats = Object.entries(templateData).map(([id, d]) => 
  `  ${id}: ${d.variables.length} vars, ${d.files.length} files`
).join('\n');
console.log(`Extracted template data to ${OUTPUT_FILE}`);
console.log(stats);
console.log(`Output size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
