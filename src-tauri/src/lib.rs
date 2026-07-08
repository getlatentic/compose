mod bundled_runtime;
mod data_reset;
pub mod db;
mod default_handler;
pub mod events;
pub mod export;
pub mod external;
pub mod files;
mod harness;
pub mod index;
pub mod logging;
mod open_with;
mod profile_migration;
pub mod review;
mod system;
mod workspace;

use tauri::{Emitter, Manager, RunEvent};

use crate::open_with::PendingOpenUrls;

/// Emit a native boot timestamp to stderr (COMPOSE_PERF builds only), so the
/// pre-JS launch phases correlate with the front-end `markBoot` marks. Compiles
/// out of a normal release build (`option_env!` is `None` → dead-code-eliminated).
#[inline]
fn boot_native_mark(label: &str) {
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
    // The aptabase analytics plugin starts its dispatcher with `tokio::spawn` at
    // setup (and flushes via reqwest on exit) — both need an entered Tokio
    // runtime, which Tauri v2 doesn't provide on the main thread. When analytics
    // is built in, hold a multi-threaded runtime entered for the app's lifetime
    // (its worker threads run the poller); unconfigured builds skip it entirely.
    let analytics_rt: Option<tokio::runtime::Runtime> = match option_env!("COMPOSE_APTABASE_KEY") {
        Some(key) if !key.is_empty() => Some(
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build the analytics Tokio runtime"),
        ),
        _ => None,
    };
    let _analytics_guard = analytics_rt.as_ref().map(|rt| rt.enter());

    // A "Reset all data" requested last session is applied here — before the
    // migration below or the webview can repopulate anything — so the app comes
    // up as a clean first-run.
    data_reset::apply_pending_reset();
    // Before Tauri creates the webview (which would make its own empty data
    // dirs under the new bundle id), carry a previous identity's profile
    // forward so a rename doesn't reset the user's workspaces or settings.
    profile_migration::migrate_legacy_profile();

    let mut builder = tauri::Builder::default()
        .manage(workspace::WorkspaceRegistry::default())
        .manage(db::MetadataStore::default())
        .manage(files::watcher::WatcherManager::default())
        .manage(harness::runner::RunnerState::default())
        .manage(harness::model_manager::ModelPullState::default())
        .manage(review::ReviewSessionStore::default())
        .manage(index::WorkspaceIndexStore::default())
        .manage(external::ExternalFilesRegistry::default())
        .manage(PendingOpenUrls::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Self-update: check a signed manifest, download + swap the bundle, and
        // relaunch (`tauri_plugin_process`). Inert until armed — see
        // `plugins.updater` in tauri.conf.json (pubkey + endpoint).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Anonymous active-user analytics — registered only when the build carries an
    // Aptabase app key (COMPOSE_APTABASE_KEY, evaluated at compile time → no-op
    // when unset). The frontend fires one `app_launched` event per launch, gated
    // on the user's opt-out toggle; this plugin performs the (Rust-side) send.
    if let Some(key) = option_env!("COMPOSE_APTABASE_KEY") {
        if !key.is_empty() {
            builder = builder.plugin(tauri_plugin_aptabase::Builder::new(key).build());
        }
    }

    let app = builder
        // A native menu set at construction (so there's no default→custom menu-bar
        // flash on launch): the platform defaults plus File → Print (⌘P). Print
        // emits `menu://print` (routed in `setup`) → the editor opens the system
        // print panel (a printer, or Save as PDF from the panel).
        .menu(|handle| {
            use tauri::menu::{Menu, MenuItem, Submenu};
            let menu = Menu::default(handle)?;
            let print =
                MenuItem::with_id(handle, "print", "Print…", true, Some("CmdOrCtrl+P"))?;
            // `Menu::default` already has a File submenu — add Print to it rather
            // than inserting a second File.
            let mut added = false;
            for item in menu.items()? {
                if let Some(file) = item.as_submenu() {
                    if file.text().map(|text| text == "File").unwrap_or(false) {
                        file.append(&print)?;
                        added = true;
                        break;
                    }
                }
            }
            if !added {
                menu.insert(&Submenu::with_items(handle, "File", true, &[&print])?, 1)?;
            }
            Ok(menu)
        })
        .setup(|app| {
            boot_native_mark("setup-start");
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

            // File → Print (⌘P) lives on the builder menu (set at construction so
            // there's no menu-bar flash). Here we only route its event: Print emits
            // `menu://print`, which the editor turns into a system print-panel run.
            app.on_menu_event(|app, event| {
                if event.id() == "print" {
                    let _ = app.emit("menu://print", ());
                }
            });

            let registry = app_handle.state::<workspace::WorkspaceRegistry>();
            if let Err(error) = registry.init_from_app(&app_handle) {
                eprintln!("workspace registry init failed: {error}");
            }
            let externals = app_handle.state::<external::ExternalFilesRegistry>();
            if let Err(error) = externals.init_from_app(&app_handle) {
                eprintln!("external files registry init failed: {error}");
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
            // Put Compose's bundled Node + uv ahead of any system install, and
            // point npm at a writable prefix for lazily-installed CLI agents, so
            // a user needs no developer-tool setup. Before the keychain export /
            // readiness probes below, so the harness's cached PATH includes it.
            if let (Ok(resource_dir), Ok(data_dir)) =
                (app_handle.path().resource_dir(), app_handle.path().app_data_dir())
            {
                bundled_runtime::configure(&resource_dir, &data_dir);
            }
            // A Finder-launched .app inherits only the minimal launchd PATH, and
            // the login-shell PATH query can come back without nvm (a heavy
            // ~/.zshrc whose lazy nvm init no-ops under a stripped PATH). Add the
            // user's toolchain dirs deterministically so an nvm-installed bob/codex
            // resolves — a fast directory scan, so it stays on the launch path.
            bundled_runtime::append_user_tool_dirs();
            // Warm the harness PATH cache OFF the main thread: augmented_node_path
            // runs a login-shell query (`$SHELL -lic env`) that can take ~1-2s
            // against a heavy ~/.zshrc. Doing it here, not on the launch path, lets
            // the window paint immediately and makes the first interaction with ANY
            // harness fast — it's harness-neutral, not tied to whichever CLI is the
            // default. The deterministic dirs added above already make an
            // nvm-installed CLI resolvable, so detection is correct before this lands.
            std::thread::spawn(|| {
                let _ = ::harness::augmented_node_path();
            });
            let metadata = app_handle.state::<db::MetadataStore>();
            if let Err(error) = metadata.init_from_app(&app_handle) {
                eprintln!("metadata store init failed: {error}");
            }
            // Reap any agent child a prior hard crash orphaned, and point the
            // runner at the data dir so this session records its own live runs
            // for the same safety net. set_data_dir is instant (before any run);
            // the sweep shells `ps`/kill, so it goes off the launch path.
            if let Ok(data_dir) = app_handle.path().app_data_dir() {
                app_handle
                    .state::<harness::runner::RunnerState>()
                    .set_data_dir(data_dir.clone());
                std::thread::spawn(move || harness::orphan_runs::sweep(&data_dir));
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
                boot_native_mark("pre-focus");
                let _ = window.set_focus();
                if want_devtools {
                    window.open_devtools();
                }
            }
            boot_native_mark("setup-end");
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
            harness::ollama_runtime::ollama_start,
            harness::ollama_runtime::ollama_installed,
            system::commands::system_readiness,
            system::commands::system_install_dependency,
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
            files::workspace_rename_file,
            files::workspace_restore_version,
            files::workspace_scan,
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
            export::workspace_export_pdf,
            export::workspace_export_html,
            export::workspace_print,
            logging::report_client_error,
            logging::open_error_log,
            open_with::drain_pending_open_urls,
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

    boot_native_mark("pre-run-loop");
    app.run(|app_handle, event| match event {
        RunEvent::Opened { urls } => {
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
        // Quitting — signal every in-flight agent child so it doesn't orphan
        // and keep editing files after the app is gone.
        RunEvent::ExitRequested { .. } => {
            app_handle
                .state::<harness::runner::RunnerState>()
                .cancel_all();
        }
        _ => {}
    });
}
