mod accessibility;
mod app_group;
mod app_identity;
mod autocorrect;
mod backgrounds;
mod boot_payload;
mod capture;
mod clipboard;
#[cfg(target_os = "macos")]
mod clipper;
mod deep_link;
mod services;
mod share_inbox;
mod spotlight;
mod launch_window;
mod login_item;
mod main_window;
mod stale_state;
mod user_tool_dirs;
mod data_reset;
pub mod db;
mod default_handler;
mod image_file;
mod document_kind;
pub mod events;
pub mod export;
pub mod external;
pub mod files;
mod finder_extension;
mod harness;
pub mod index;
mod launch;
pub mod logging;
mod menu;
mod open_with;
mod paged;
mod profile_migration;
pub mod review;
mod system;
mod system_fonts;
mod workspace;



/// Emit a native boot timestamp to stderr (COMPOSE_PERF builds only), so the
/// pre-JS launch phases correlate with the front-end `markBoot` marks. Compiles
/// out of a normal release build (`option_env!` is `None` → dead-code-eliminated).
#[inline]
pub(crate) fn boot_native_mark(label: &str) {
    if option_env!("COMPOSE_PERF").is_some() {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        eprintln!("[boot-native] {label} @ {ms}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    boot_native_mark("run-start");
    let analytics_rt = launch::analytics_runtime();
    let _analytics_guard = analytics_rt.as_ref().map(|rt| rt.enter());
    launch::prepare_profile();

    // The launch screen's data, read from disk before the web view exists and
    // handed to the main window's page as a global so its first render is the
    // finished app rather than an empty shell that fills in. Empty when there is
    // nothing to say, which injects nothing and leaves the front end's own IPC
    // fan-out — still the source of truth — to do exactly what it did before.
    let boot_script = boot_payload::init_script(app_identity::profile_dir());
    boot_native_mark("boot-payload");

    let builder = launch::builder();
    boot_native_mark("builder-constructed");
    let app = builder
        // A native menu set at construction (so there's no default→custom menu-bar
        // flash on launch): the platform defaults plus File → Print (⌘P). Print
        // emits `menu://print` (routed in `setup`) → the editor opens the system
        // print panel (a printer, or Save as PDF from the panel).
        .menu(menu::build)
        .setup(move |app| launch::setup(app, boot_script))
        .invoke_handler(tauri::generate_handler![
            accessibility::solid_window_frame,
            system_fonts::system_font_families,
            backgrounds::background_image_store,
            backgrounds::background_image_allow,
            export::card_commands::card_preview_html,
            export::card_commands::document_export_image,
            export::card_commands::card_copy_image,
            export::card_commands::card_share,
            harness::runner::run_harness_stream,
            harness::runner::cancel_harness_run,
            harness::commands::harness_list,
            harness::commands::harness_discover,
            harness::commands::harness_readiness,
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
            harness::ollama_runtime::ollama_start,
            harness::ollama_runtime::ollama_installed,
            system::commands::system_readiness,
            data_reset::app_reset_all_data,
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
            files::workspace_create_folder,
            files::workspace_delete_file,
            files::workspace_delete_folder,
            files::workspace_list_versions,
            files::workspace_read_file,
            paged::paged_open,
            paged::paged_window,
            paged::paged_window_from,
            paged::paged_window_before,
            paged::paged_progress,
            paged::paged_edit,
            paged::paged_save,
            paged::paged_changed_on_disk,
            paged::paged_close,
            files::workspace_rename_file,
            files::workspace_restore_version,
            files::workspace_scan,
            files::workspace_files_snapshot,
            launch_window::launch_window_ready,
            launch_window::launch_document_parsed,
            login_item::login_item_status,
            login_item::login_item_set,
            login_item::login_item_settings,
            files::workspace_scan_folders,
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
            export::document_export_pdf,
            export::document_export_html,
            export::document_export_markdown,
            export::document_print,
            logging::report_client_error,
            logging::open_error_log,
            open_with::drain_pending_open_urls,
            services::drain_pending_service_text,
            share_inbox::share_inbox_pending,
            capture::capture_save,
            capture::capture_close,
            capture::capture_destination,
            capture::capture_shortcuts,
            capture::capture_set_shortcut,
            capture::notes::quick_notes,
            capture::notes::quick_note_keep,
            capture::notes::quick_note_delete,
            capture::notes::quick_note_keep_image,
            capture::notes::quick_note_folder,
            clipboard::clipboard_history,
            clipboard::clipboard_set_enabled,
            clipboard::clipboard_entry,
            clipboard::clipboard_copy,
            clipboard::clipboard_pin,
            clipboard::clipboard_forget,
            clipboard::clipboard_clear,
            clipboard::clipboard_privacy_settings,
            share_inbox::share_inbox_import,
            finder_extension::finder_extension_enabled,
            finder_extension::finder_extension_settings,
            spotlight::spotlight_enabled,
            spotlight::spotlight_set_enabled,
            external::external_list,
            external::external_add,
            external::external_remove,
            external::external_save_tabs,
            external::external_read_file,
            external::external_write_file,
            external::resolve_open_path,
            default_handler::markdown_handler_status,
            default_handler::set_default_markdown_handler,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    boot_native_mark("app-built");
    app.run(launch::handle_run_event);
}
