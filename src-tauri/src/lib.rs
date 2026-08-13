mod jsonl;
mod pi_child;

use pi_child::{reap, spawn_pi, write_command, PiState};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Listener, Manager};

fn require_ready(state: &PiState) -> Result<(), String> {
    if !*state.ready.lock().unwrap() {
        return Err(state.reason.lock().unwrap().clone());
    }
    Ok(())
}

#[tauri::command]
fn pi_status(state: tauri::State<PiState>) -> Value {
    json!({
        "ready": *state.ready.lock().unwrap(),
        "reason": *state.reason.lock().unwrap(),
    })
}

#[tauri::command]
fn pi_prompt(
    state: tauri::State<PiState>,
    id: String,
    message: String,
    streaming_behavior: Option<String>,
) -> Result<(), String> {
    require_ready(&state)?;
    let mut body = json!({"id": id, "type": "prompt", "message": message});
    if let Some(behavior) = streaming_behavior {
        body["streamingBehavior"] = json!(behavior);
    }
    write_command(&state, body)
}

#[tauri::command]
fn pi_steer(state: tauri::State<PiState>, id: String, message: String) -> Result<(), String> {
    require_ready(&state)?;
    write_command(&state, json!({"id": id, "type": "steer", "message": message}))
}

#[tauri::command]
fn pi_follow_up(state: tauri::State<PiState>, id: String, message: String) -> Result<(), String> {
    require_ready(&state)?;
    write_command(&state, json!({"id": id, "type": "follow_up", "message": message}))
}

#[tauri::command]
fn pi_abort(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    require_ready(&state)?;
    write_command(&state, json!({"id": id, "type": "abort"}))
}

#[tauri::command]
fn pi_new_session(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    require_ready(&state)?;
    write_command(&state, json!({"id": id, "type": "new_session"}))
}

#[tauri::command]
fn pi_get_state(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "get_state"}))
}

#[tauri::command]
fn pi_get_messages(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    require_ready(&state)?;
    write_command(&state, json!({"id": id, "type": "get_messages"}))
}

#[tauri::command]
fn pi_extension_ui_response(
    state: tauri::State<PiState>,
    id: String,
    confirmed: Option<bool>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    require_ready(&state)?;
    let mut body = json!({"type": "extension_ui_response", "id": id});
    if let Some(c) = confirmed {
        body["confirmed"] = json!(c);
    }
    if cancelled == Some(true) {
        body["cancelled"] = json!(true);
    }
    write_command(&state, body)
}

pub fn run() {
    tauri::Builder::default()
        .manage(PiState {
            child: Mutex::new(None),
            ready: Mutex::new(false),
            reason: Mutex::new("Pi is not ready".into()),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            match spawn_pi(&handle) {
                Ok(()) => {
                    let id = "ready-1";
                    let handle2 = handle.clone();
                    let _unlisten = handle.listen("pi-event", move |event| {
                        let payload = event.payload();
                        if let Ok(v) = serde_json::from_str::<Value>(payload) {
                            if v["type"] == "response"
                                && v["command"] == "get_state"
                                && v["id"] == "ready-1"
                            {
                                let state = handle2.state::<PiState>();
                                if v["success"] == true {
                                    *state.ready.lock().unwrap() = true;
                                    *state.reason.lock().unwrap() = String::new();
                                } else {
                                    *state.ready.lock().unwrap() = false;
                                    *state.reason.lock().unwrap() =
                                        v["error"].as_str().unwrap_or("get_state failed").to_string();
                                }
                            }
                        }
                    });
                    let _event_id = _unlisten;
                    let _ = write_command(
                        app.state::<PiState>().inner(),
                        json!({"id": id, "type": "get_state"}),
                    );
                }
                Err(reason) => {
                    let state = app.state::<PiState>();
                    *state.ready.lock().unwrap() = false;
                    *state.reason.lock().unwrap() = reason;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                reap(window.state::<PiState>().inner());
            }
        })
        .invoke_handler(tauri::generate_handler![
            pi_status,
            pi_prompt,
            pi_steer,
            pi_follow_up,
            pi_abort,
            pi_new_session,
            pi_get_state,
            pi_get_messages,
            pi_extension_ui_response
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
