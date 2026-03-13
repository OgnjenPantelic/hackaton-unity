export const ASSISTANT = {
  MAX_HISTORY_MESSAGES: 6,
} as const;

export const ASSISTANT_PROVIDERS = {
  "github-models": {
    name: "GitHub Models",
    description: "Free AI models from GitHub",
    apiKeyUrl: "https://github.com/settings/personal-access-tokens/new",
    apiKeyPlaceholder: "github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    instructions: "Create a Fine-grained Personal Access Token with 'models:read' permission (Account permissions → Models → Read-only)",
    recommended: true,
  },
  "openai": {
    name: "OpenAI",
    description: "OpenAI (paid)",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    apiKeyPlaceholder: "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    instructions: "Create a new API key from your OpenAI dashboard",
    recommended: false,
  },
  "claude": {
    name: "Claude",
    description: "Anthropic Claude (paid)",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    apiKeyPlaceholder: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    instructions: "Create a new API key from the Anthropic console",
    recommended: false,
  },
} as const;

export const SCREEN_CONTEXT: Record<string, string> = {
  "welcome": "The user is on the welcome screen. They haven't started any configuration yet. They can click 'Get Started' to begin the deployment wizard.",
  "cloud-selection": "The user is choosing a cloud provider: AWS, Azure, or GCP. Each card shows supported features. They click a cloud to proceed.",
  "dependencies": "The user is on the dependencies screen where the app checks if Terraform CLI and Databricks CLI are installed. Terraform can be auto-installed. Databricks CLI is optional but recommended. A connectivity check verifies access to registry.terraform.io, releases.hashicorp.com, and github.com — a warning appears if any are unreachable (e.g. corporate proxy).",
  "aws-credentials": "The user is configuring AWS credentials. Two modes: 'AWS CLI Profile' (recommended, uses ~/.aws/credentials or ~/.aws/config, supports SSO with non-blocking browser login and Cancel button) or 'Access Keys' (manual key entry). The app verifies identity and checks IAM permissions.",
  "azure-credentials": "The user is configuring Azure credentials. Two modes: 'Azure CLI' (recommended, click 'Sign in with Azure' for browser login with Cancel button; once logged in the button says 'Switch Account' and a 'Refresh' link detects CLI-based login) or 'Service Principal' (Tenant ID, Subscription ID, Client ID, Client Secret). After auth, they select a subscription (with 'Can't find your subscription?' help dialog) and the app checks role assignments.",
  "gcp-credentials": "The user is configuring GCP credentials. Two modes: 'Application Default Credentials' (recommended, click 'Sign in with GCP' for browser login with Cancel button; once logged in the button says 'Switch Account' and a 'Refresh' link detects CLI-based login; project and SA fields appear only after authentication; project is selected from a dropdown or entered manually) or 'Service Account Key' (paste JSON key). The service account needs Owner role on the project.",
  "databricks-credentials": "The user is entering Databricks account credentials. For GCP/Azure-identity: just the Account ID. For AWS/Azure-SP: either a CLI profile from ~/.databrickscfg (service principal only) or Client ID + Client Secret. The Account ID is a UUID from the Databricks Account Console.",
  "template-selection": "The user is selecting a Terraform deployment template. There are two templates per cloud: a Standard template (aws-simple, azure-simple, gcp-simple) for straightforward deployments, and an SRA (Security Reference Architecture) template (aws-sra, azure-sra, gcp-sra) for enterprise/regulated environments with PrivateLink/PE/PSC, customer-managed encryption keys, and compliance controls. Each card shows features.",
  "configuration": "The user is filling in Terraform template variables. Standard templates have: workspace name, region, networking (VPC/VNet/subnet CIDRs), tags, and optional existing VPC/VNet settings. SRA templates have additional options: PrivateLink/PE/PSC configuration, CMK/CMEK encryption settings, compliance profiles, Security Analysis Tool (SAT), firewall rules (Azure), hub-spoke architecture with Databricks account resources like NCC and network policy (Azure), network hardening (GCP), and IP access lists (GCP). For Azure SRA, the 'Create Hub & Account Resources' toggle controls whether hub infrastructure and Databricks account-level resources (NCC, network policy, metastore) are created or must be provided as existing IDs. SAT configuration, Allowed FQDNs, and hub naming fields are only visible when hub creation is enabled (SAT is a hub-only feature). Values have validation rules.",
  "unity-catalog-config": "The user is configuring Unity Catalog (optional). They can enable it with a catalog name and storage location (S3 bucket/Azure Storage/GCS bucket). The app auto-detects if a metastore exists in the region. Storage names must be globally unique.",
  "deployment": "The user is on the deployment screen. Terraform runs in stages: init → plan → review → apply. A resource progress timeline shows each resource's status (pending/creating/created/imported) with a progress bar. If apply fails with 'already exists' errors, the app auto-imports conflicting resources and retries. They can cancel a running deployment, rollback after failure, or start a new deployment. Standard template deployments typically take 10-15 minutes. SRA template deployments typically take 20-40 minutes due to additional resources (PrivateLink, CMK, hub infrastructure, etc.).",
};

export const ASSISTANT_SAMPLE_QUESTIONS: Record<string, string[]> = {
  "welcome": [
    "What does this app do?",
    "Which cloud provider should I choose?",
    "What prerequisites do I need?",
  ],
  "cloud-selection": [
    "What's the difference between AWS, Azure, and GCP deployment?",
    "Can I deploy to multiple clouds?",
  ],
  "dependencies": [
    "Is Databricks CLI required?",
    "Can the app auto-install dependencies?",
    "What if I'm behind a corporate proxy?",
  ],
  "aws-credentials": [
    "Should I use SSO or access keys?",
    "Where do I find my AWS profile?",
    "What IAM permissions are needed?",
  ],
  "azure-credentials": [
    "What's the difference between Azure CLI and Service Principal?",
    "How do I run az login?",
    "What Azure roles do I need?",
  ],
  "gcp-credentials": [
    "How does service account impersonation work?",
    "What GCP permissions are required?",
    "How do I select a GCP project?",
  ],
  "databricks-credentials": [
    "Where do I find my Databricks Account ID?",
    "What's the difference between OAuth and service principal?",
    "Can I use my existing databrickscfg profile?",
  ],
  "template-selection": [
    "What's the difference between Standard and SRA templates?",
    "When should I use the SRA template?",
    "Can I use an existing VPC?",
  ],
  "configuration": [
    "What CIDR ranges should I use?",
    "How do I configure VPC settings?",
    "Should I enable CMK encryption?",
    "What is the Compliance Security Profile?",
    "What are the Databricks Account Resources I need when not creating a hub?",
  ],
  "unity-catalog-config": [
    "What is Unity Catalog?",
    "Do I need to create a new metastore?",
    "How do I choose a storage location?",
  ],
  "deployment": [
    "What happens during the plan stage?",
    "Can I cancel a running deployment?",
  ],
};
