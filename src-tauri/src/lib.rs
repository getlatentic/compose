mod bob;
pub mod db;
pub mod events;
pub mod export;
pub mod files;
pub mod index;
pub mod pty;
pub mod review;
mod settings;
mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(workspace::WorkspaceRegistry::default())
        .manage(db::MetadataStore::default())
        .manage(files::watcher::WatcherManager::default())
        .manage(bob::runner::BobRunnerState::default())
        .manage(review::ReviewSessionStore::default())
        .manage(index::WorkspaceIndexStore::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let registry = app_handle.state::<workspace::WorkspaceRegistry>();
            if let Err(error) = registry.init_from_app(&app_handle) {
                eprintln!("workspace registry init failed: {error}");
            }
            let metadata = app_handle.state::<db::MetadataStore>();
            if let Err(error) = metadata.init_from_app(&app_handle) {
                eprintln!("metadata store init failed: {error}");
            }
            let watchers = app_handle.state::<files::watcher::WatcherManager>();
            if let Err(error) = watchers.init(app_handle.clone()) {
                eprintln!("watcher manager init failed: {error}");
            }
            // Purge soft-deleted files past the trash retention window. Off the
            // launch path on its own thread (nothing in the app waits on it),
            // and only after metadata init above so the store is ready.
            let sweep_handle = app_handle.clone();
            std::thread::spawn(move || {
                let metadata = sweep_handle.state::<db::MetadataStore>();
                files::trash_sweep::run_startup_trash_sweep(&metadata);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bob::runner::run_harness_stream,
            bob::runner::cancel_harness_run,
            bob::runner::harness_list,
            bob::runner::harness_readiness,
            bob::runner::harness_install,
            bob::runner::harness_login,
            settings::settings_check_bob_install,
            settings::settings_get_bob_auth_status,
            settings::settings_install_bob,
            settings::settings_set_bob_api_key,
            settings::settings_verify_bob_runtime,
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
            review::workspace_review_diff,
            review::workspace_apply_review_change,
            review::workspace_review_cleanup,
            index::workspace_index_snapshot,
            index::workspace_rebuild_index,
            index::workspace_search_index,
            export::workspace_export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
