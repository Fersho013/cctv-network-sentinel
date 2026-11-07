use tauri::command;

#[command]
fn scan_subnet(subnet: String) -> String {
    // TODO: implementar escaneo nativo
    format!("scanning {}", subnet)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_subnet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
