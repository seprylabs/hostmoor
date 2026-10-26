mod check;
mod commands;
mod deploy;
mod db;
mod models;
mod ssh;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ~/Library/Application Support/de.spmedia.stackport/stackport.db
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("stackport.db"))?);
            app.manage(deploy::Running::default());
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
            commands::set_deploy_script,
            commands::list_deploys,
            commands::start_deploy,
            commands::cancel_deploy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
