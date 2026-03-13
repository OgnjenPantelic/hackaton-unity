// Existing screens (default exports)
export { default as WelcomeScreen } from "./WelcomeScreen";
export { default as CloudSelectionScreen } from "./CloudSelectionScreen";
export { default as DependenciesScreen } from "./DependenciesScreen";

// New screens
export { TemplateSelectionScreen } from "./TemplateSelectionScreen";
export { ConfigurationScreen } from "./ConfigurationScreen";
export { UnityCatalogConfigScreen } from "./UnityCatalogConfigScreen";
export { DeploymentScreen } from "./DeploymentScreen";

// Credentials screens
export {
  GcpCredentialsScreen,
  DatabricksCredentialsScreen,
  AwsCredentialsScreen,
  AzureCredentialsScreen,
} from "./credentials";
