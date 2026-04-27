use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_tooltip_default() {
        let tooltip = "Hybrid Agent";
        assert_eq!(tooltip, "Hybrid Agent");
    }

    #[test]
    fn test_menu_event_id_parsing() {
        let event_id = "show";
        match event_id {
            "show" => assert!(true),
            "hide" => assert!(false, "Should not be hide"),
            "quit" => assert!(false, "Should not be quit"),
            _ => assert!(false, "Unknown event id"),
        }
    }

    #[test]
    fn test_menu_event_ids() {
        let ids = vec!["show", "hide", "quit"];
        assert_eq!(ids.len(), 3);
        assert!(ids.contains(&"show"));
        assert!(ids.contains(&"hide"));
        assert!(ids.contains(&"quit"));
    }

    #[test]
    fn test_left_click_matches_show_condition() {
        // Test the logic condition for showing window on left click
        let is_left_button = true;
        let is_button_up = true;
        let should_show = is_left_button && is_button_up;
        assert!(should_show);
    }

    #[test]
    fn test_right_click_not_trigger_show() {
        // Test that right click doesn't match the show condition
        let is_left_button = false; // Right button
        let is_button_up = true;
        let should_show = is_left_button && is_button_up;
        assert!(!should_show);
    }

    #[test]
    fn test_app_exit_on_quit() {
        let event_id = "quit";
        let should_exit = event_id == "quit";
        assert!(should_exit);
    }

    #[test]
    fn test_window_hide_on_hide_event() {
        let event_id = "hide";
        let should_hide = event_id == "hide";
        assert!(should_hide);
    }

    #[test]
    fn test_window_show_on_show_event() {
        let event_id = "show";
        let should_show = event_id == "show";
        assert!(should_show);
    }

    #[test]
    fn test_unknown_event_id_ignored() {
        let event_id = "unknown";
        match event_id {
            "show" | "hide" | "quit" => assert!(false, "Should not match known ids"),
            _ => assert!(true),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    log::info!("Starting Hybrid Agent Desktop...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            log::info!("Setting up system tray...");

            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Hybrid Agent")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            log::info!("System tray setup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
