mod commands;
mod crypto;
mod dependencies;
mod errors;
pub(crate) mod proxy;
mod terraform;

use commands::debug_log;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // Single-instance: second launch is ignored (focus logic could be added here)
        }))
        .setup(|app| {
            // Extract templates to app data directory on first run or when template version changes
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(_e) = commands::setup_templates(&app_handle) {
                    debug_log!("Failed to setup templates: {}", _e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_dependencies,
            commands::check_terraform_connectivity,
            commands::install_terraform,
            commands::validate_databricks_credentials,
            commands::get_templates,
            commands::get_template_variables,
            commands::save_configuration,
            commands::run_terraform_command,
            commands::get_deployment_status,
            commands::reset_deployment_status,
            commands::cancel_deployment,
            commands::rollback_deployment,
            commands::get_cloud_credentials,
            commands::get_aws_profiles,
            commands::get_aws_identity,
            commands::aws_sso_login,
            commands::get_azure_account,
            commands::get_azure_subscriptions,
            commands::get_azure_resource_groups,
            commands::get_azure_resource_groups_sp,
            commands::get_azure_vnets,
            commands::get_azure_vnets_sp,
            commands::azure_login,
            commands::cancel_cli_login,
            commands::set_azure_subscription,
            commands::check_resource_names_available,
            commands::check_resource_names_available_sp,
            commands::clear_templates_cache,
            commands::get_deployments_folder,
            commands::open_folder,
            commands::open_url,
            commands::get_databricks_profiles,
            commands::databricks_cli_login,
            commands::get_databricks_profile_credentials,
            commands::create_databricks_sp_profile,
            commands::check_uc_permissions,
            commands::check_aws_permissions,
            commands::check_azure_permissions,
            commands::validate_gcp_credentials,
            commands::get_gcp_projects,
            commands::gcp_login,
            commands::check_gcp_permissions,
            commands::validate_gcp_databricks_access,
            commands::validate_gcp_databricks_access_with_key,
            commands::validate_databricks_profile,
            commands::validate_azure_databricks_identity,
            commands::create_gcp_service_account,
            commands::add_service_account_to_databricks,
            // Git / GitHub integration
            commands::git_get_status,
            commands::git_init_repo,
            commands::git_check_remote,
            commands::git_push_to_remote,
            commands::preview_tfvars_example,
            commands::github_device_auth_start,
            commands::github_device_auth_poll,
            commands::github_get_auth,
            commands::github_logout,
            commands::github_create_repo,
            commands::check_for_updates,
            // AI Assistant
            commands::assistant_save_token,
            commands::assistant_chat,
            commands::assistant_get_settings,
            commands::assistant_switch_provider,
            commands::assistant_reconnect,
            commands::assistant_delete_provider_key,
            commands::assistant_delete_all_keys,
            commands::assistant_get_available_models,
            commands::assistant_update_model,
            commands::assistant_save_history,
            commands::assistant_clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
