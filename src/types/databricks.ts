export interface DatabricksProfile {
  name: string;
  host: string;
  account_id: string | null;
  has_client_credentials: boolean;
  has_token: boolean;
  cloud: string;
}

export interface UnityCatalogConfig {
  enabled: boolean;
  catalog_name: string;
  storage_name: string;
  metastore_id: string;
}

export interface MetastoreInfo {
  exists: boolean;
  metastore_id: string | null;
  metastore_name: string | null;
  region: string | null;
}

export interface UCPermissionCheck {
  metastore: MetastoreInfo;
  has_create_catalog: boolean;
  has_create_external_location: boolean;
  has_create_storage_credential: boolean;
  can_create_catalog: boolean;
  message: string;
}
