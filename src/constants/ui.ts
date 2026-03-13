export const POLLING = {
  STATUS_INTERVAL: 1000,
  ROLLBACK_INTERVAL: 500,
  SSO_CHECK_INTERVAL: 1000,
  SSO_MAX_ATTEMPTS: 60,
  MIN_LOADING_TIME: 1000,
} as const;

export const UI = {
  REACT_PAINT_DELAY: 50,
} as const;

export const DEFAULTS = {
  SUFFIX_LENGTH: 8,
  PUBLIC_SUBNET_CIDR: "10.0.0.0/22",
  PRIVATE_SUBNET_CIDR: "10.0.4.0/22",
  AZURE_REGION: "eastus2",
  GCP_REGION: "us-central1",
} as const;
