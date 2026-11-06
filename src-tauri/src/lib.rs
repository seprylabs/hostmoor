// First, so the tr! macro is available in all modules below
#[macro_use]
mod i18n;

mod check;
mod ci;
mod ci_watch;
mod commands;
mod db;
mod deploy;
mod models;
mod ssh;
mod terminal;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Restart after installing an update
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // System language until the UI sends the user's choice
            i18n::set(None);
            // macOS: ~/Library/Application Support/de.spmedia.stackport/stackport.db
            // Windows: %APPDATA%\de.spmedia.stackport\stackport.db
            // Linux: ~/.local/share/de.spmedia.stackport/stackport.db
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("stackport.db"))?);
            app.manage(deploy::Running::default());
            app.manage(ci_watch::CiWatch::default());
            ci_watch::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_all,
            commands::save_customer,
            commands::save_server,
            commands::save_project,
            commands::delete_entity,
            commands::set_favorite,
            commands::export_backup,
            commands::import_backup,
            commands::test_connection,
            commands::check_server,
            commands::open_terminal,
            commands::list_terminals,
            commands::set_deploy_script,
            commands::list_deploys,
            commands::last_deploys,
            commands::start_deploy,
            commands::cancel_deploy,
            commands::ci_runs,
            commands::set_ci_token,
            commands::ci_overview,
            commands::set_language,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
