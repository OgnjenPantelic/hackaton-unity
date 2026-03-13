export interface DependencyStatus {
  name: string;
  installed: boolean;
  version: string | null;
  required: boolean;
  install_url: string;
}

export interface Template {
  id: string;
  name: string;
  cloud: string;
  description: string;
  features: string[];
}

export interface TerraformVariable {
  name: string;
  description: string;
  var_type: string;
  default: string | null;
  required: boolean;
  sensitive: boolean;
  validation: string | null;
}

export interface DeploymentStatus {
  running: boolean;
  command: string | null;
  output: string;
  success: boolean | null;
  can_rollback: boolean;
}

export type AppScreen =
  | 'welcome'
  | 'dependencies'
  | 'cloud-selection'
  | 'databricks-credentials'
  | 'aws-credentials'
  | 'azure-credentials'
  | 'gcp-credentials'
  | 'template-selection'
  | 'configuration'
  | 'unity-catalog-config'
  | 'deployment';
