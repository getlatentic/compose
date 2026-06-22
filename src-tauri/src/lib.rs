pub mod db;
pub mod events;
pub mod export;
pub mod files;
mod harness;
pub mod index;
pub mod logging;
mod open_with;
mod profile_migration;
pub mod review;
mod workspace;

use tauri::{Emitter, Manager, RunEvent};

use crate::open_with::PendingOpenUrls;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before Tauri creates the webview (which would make its own empty data
    // dirs under the new bundle id), carry a previous identity's profile
    // forward so a rename doesn't reset the user's workspaces or settings.
    profile_migration::migrate_legacy_profile();

    let app = tauri::Builder::default()
        .manage(workspace::WorkspaceRegistry::default())
        .manage(db::MetadataStore::default())
        .manage(files::watcher::WatcherManager::default())
        .manage(harness::runner::RunnerState::default())
        .manage(harness::model_manager::ModelPullState::default())
        .manage(review::ReviewSessionStore::default())
        .manage(index::WorkspaceIndexStore::default())
        .manage(PendingOpenUrls::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Capture back-end panics into the local error log (best-effort),
            // then chain to the default hook. Resolve the path once here so the
            // hook needs no AppHandle.
            if let Ok(log_path) = logging::error_log_path(&app_handle) {
                let default_hook = std::panic::take_hook();
                std::panic::set_hook(Box::new(move |info| {
                    let _ = logging::append_error_line(
                        &log_path,
                        "panic",
                        &info.to_string(),
                        None,
                        logging::now_ms(),
                    );
                    default_hook(info);
                }));
            }
            let registry = app_handle.state::<workspace::WorkspaceRegistry>();
            if let Err(error) = registry.init_from_app(&app_handle) {
                eprintln!("workspace registry init failed: {error}");
            }
            // Load user-registered custom agents before export_all (below) reads
            // their keys. A plain JSON read, so safe inline (unlike the keychain).
            match app_handle.path().app_config_dir() {
                Ok(config_dir) => {
                    if let Err(error) =
                        harness::custom::custom_agent_store().init_from_dir(&config_dir)
                    {
                        eprintln!("custom-agent store init failed: {error}");
                    }
                }
                Err(error) => eprintln!("app config dir unavailable for custom agents: {error}"),
            }
            // Point agent-harness's models.dev catalog cache at the app cache
            // dir, so the model picker works offline after one online fetch.
            if let Ok(cache_dir) = app_handle.path().app_cache_dir() {
                std::env::set_var("AGENT_HARNESS_CACHE_DIR", cache_dir);
            }
            let metadata = app_handle.state::<db::MetadataStore>();
            if let Err(error) = metadata.init_from_app(&app_handle) {
                eprintln!("metadata store init failed: {error}");
            }
            let watchers = app_handle.state::<files::watcher::WatcherManager>();
            if let Err(error) = watchers.init(app_handle.clone()) {
                eprintln!("watcher manager init failed: {error}");
            }
            // Off the main thread: reading the keychain blocks on a macOS ACL
            // prompt when the app signature doesn't match the stored item (any
            // re-signed build), and inline that stalls the setup hook — so
            // `app.run()` never starts and the boot IPC responses never reach
            // the webview, leaving the splash up forever. Nothing on the launch
            // path awaits the export; a harness whose key hasn't landed yet just
            // probes "not ready" until it does.
            std::thread::spawn(harness::credentials::export_all);
            // Purge soft-deleted files past the trash retention window. Off the
            // launch path on its own thread (nothing in the app waits on it),
            // and only after metadata init above so the store is ready.
            let sweep_handle = app_handle.clone();
            std::thread::spawn(move || {
                let metadata = sweep_handle.state::<db::MetadataStore>();
                files::trash_sweep::run_startup_trash_sweep(&metadata);
            });
            // Open Safari Web Inspector on launch when this build was made with
            // `COMPOSE_DEVTOOLS=1 pnpm tauri build`. `option_env!` evaluates at
            // compile time, so a normal release build never opens the inspector.
            #[cfg(debug_assertions)]
            let want_devtools = true;
            #[cfg(not(debug_assertions))]
            let want_devtools = option_env!("COMPOSE_DEVTOOLS").is_some();
            if let Some(window) = app_handle.get_webview_window("main") {
                // Force the window forward on launch. A WKWebView whose window
                // is never visible at launch (created behind another app — a
                // background/`open`-from-terminal launch) doesn't begin
                // executing the page's JS, so the boot IPC handoff never runs
                // and the splash hangs until the window is clicked. Focusing it
                // makes the view visible so the WebView starts; once running,
                // `backgroundThrottling: disabled` keeps it alive if the window
                // is later occluded mid-boot.
                let _ = window.set_focus();
                if want_devtools {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            harness::runner::run_harness_stream,
            harness::runner::cancel_harness_run,
            harness::commands::harness_list,
            harness::commands::harness_discover,
            harness::commands::harness_readiness,
            harness::commands::harness_install,
            harness::commands::harness_login,
            harness::commands::harness_verify_runtime,
            harness::commands::harness_list_models,
            harness::commands::harness_set_credential,
            harness::commands::harness_credential_status,
            harness::custom_commands::harness_list_custom,
            harness::custom_commands::harness_add_custom,
            harness::custom_commands::harness_update_custom,
            harness::custom_commands::harness_remove_custom,
            harness::input_spill::spill_chat_input,
            harness::model_manager::harness_model_management,
            harness::model_manager::harness_installed_models,
            harness::model_manager::harness_pull_model,
            harness::model_manager::harness_cancel_pull,
            harness::model_manager::harness_delete_model,
            workspace::setup_complete_onboarding,
            workspace::setup_get_onboarding,
            workspace::workspace_add,
            workspace::workspace_list,
            workspace::workspace_mark_opened,
            workspace::workspace_remove,
            workspace::workspace_save_tabs,
            workspace::workspace_status,
            workspace::workspace_switch,
            db::conversations::conversation_archive,
            db::conversations::conversation_delete,
            db::conversations::conversation_duplicate,
            db::conversations::conversation_list,
            db::conversations::conversation_load,
            db::conversations::conversation_load_active,
            db::conversations::conversation_new,
            db::conversations::conversation_rename,
            db::conversations::conversation_save,
            db::metadata_append_llm_message,
            db::metadata_load_comments,
            db::metadata_load_llm_thread,
            db::metadata_record_llm_thread,
            db::metadata_save_comments,
            files::workspace_create_file,
            files::workspace_delete_file,
            files::workspace_list_versions,
            files::workspace_read_file,
            files::workspace_rename_file,
            files::workspace_restore_version,
            files::workspace_scan,
            files::workspace_write_binary_file,
            files::workspace_write_file,
            files::starter::workspace_create_starter,
            review::workspace_review_diff,
            review::workspace_snapshot_diff,
            review::workspace_apply_review_change,
            review::workspace_review_cleanup,
            index::workspace_index_snapshot,
            index::workspace_rebuild_index,
            index::workspace_search_index,
            export::workspace_export_pdf,
            export::workspace_export_html,
            logging::report_client_error,
            logging::open_error_log,
            open_with::drain_pending_open_urls,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Opened { urls } = event {
            let pending = app_handle.state::<PendingOpenUrls>();
            for url in urls {
                let Some(path) = url
                    .to_file_path()
                    .ok()
                    .and_then(|p| p.to_str().map(String::from))
                else {
                    continue;
                };
                // Buffer first so a frontend that mounts later can drain it.
                pending.push(path.clone());
                // Best-effort live emit for the warm-start case.
                let _ = app_handle.emit("compose:open-external-file", path);
            }
        }
    });
}
