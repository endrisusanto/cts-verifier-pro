// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter, path::BaseDirectory, Manager};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
struct Device {
    id: String,
    status: String,
    model: String,
    version: String,
    sdk: String,
    security_patch: String,
    carrier: String,
    region: String,
    pda: String,
    sw_ver: String,
    csc: String,
}

#[derive(Serialize, Clone)]
struct LogPayload {
    device_id: String,
    message: String,
    status: String,
    progress: f32,
}

#[tauri::command]
async fn get_devices() -> Result<Vec<Device>, String> {
    let output = Command::new("adb").arg("devices").output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();

    for line in stdout.lines().skip(1) {
        if line.is_empty() { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let id = parts[0].to_string();
            let status = parts[1].to_string();
            if status == "device" {
                let props = get_device_props(&id);
                devices.push(Device {
                    id, status,
                    model: props.get("ro.product.model").cloned().unwrap_or_default(),
                    version: props.get("ro.build.version.release").cloned().unwrap_or_default(),
                    sdk: props.get("ro.system.build.version.sdk_full").cloned().unwrap_or_default(),
                    security_patch: props.get("ro.build.version.security_patch").cloned().unwrap_or_default(),
                    carrier: props.get("ro.csc.sales_code").cloned().unwrap_or_default(),
                    region: props.get("ro.csc.country_code").cloned().unwrap_or_default(),
                    pda: props.get("ro.build.PDA").cloned().unwrap_or_default(),
                    sw_ver: props.get("ril.sw_ver").cloned().unwrap_or_default(),
                    csc: props.get("ril.official_cscver").cloned().unwrap_or_default(),
                });
            } else {
                devices.push(Device { id, status, ..Default::default() });
            }
        }
    }
    Ok(devices)
}

fn get_device_props(device_id: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let props_to_get = vec![
        "ro.product.model", "ro.build.version.release", "ro.system.build.version.sdk_full",
        "ro.build.version.security_patch", "ro.csc.sales_code", "ro.csc.country_code",
        "ro.build.PDA", "ril.sw_ver", "ril.official_cscver",
    ];
    for prop in props_to_get {
        let output = Command::new("adb").args(&["-s", device_id, "shell", "getprop", prop]).output();
        if let Ok(out) = output {
            let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
            map.insert(prop.to_string(), val);
        }
    }
    map
}

impl Default for Device {
    fn default() -> Self {
        Self {
            id: "".into(), status: "".into(), model: "Unknown".into(),
            version: "".into(), sdk: "".into(), security_patch: "".into(),
            carrier: "".into(), region: "".into(), pda: "".into(), sw_ver: "".into(), csc: "".into(),
        }
    }
}

#[tauri::command]
async fn run_install_sequence(app: AppHandle, device_id: String) -> Result<(), String> {
    let log = |msg: &str, stat: &str, prog: f32| {
        let _ = app.emit("install-log", LogPayload {
            device_id: device_id.clone(), message: msg.to_string(), status: stat.to_string(), progress: prog,
        });
    };

    let run_adb = |args: Vec<&str>| -> Result<String, String> {
        let mut final_args = vec!["-s", &device_id];
        final_args.extend(args);
        let output = Command::new("adb").args(&final_args).output()
            .map_err(|e| format!("ADB error: {}", e))?;
        if output.status.success() { Ok(String::from_utf8_lossy(&output.stdout).to_string()) }
        else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
    };

    // Use Tauri's resource path resolution
    let resource_path = app.path().resolve("apks", BaseDirectory::Resource)
        .map_err(|e| format!("Resource error: {}", e))?;

    let apks = [
        resource_path.join("CtsVerifier.apk"),
        resource_path.join("CtsPermissionApp.apk"),
        resource_path.join("CtsEmptyDeviceOwner.apk")
    ];
    
    for apk in &apks { 
        if !apk.exists() { 
            return Err(format!("APK not found in resources: {}", apk.file_name().unwrap().to_string_lossy())); 
        } 
    }

    log("Starting...", "info", 5.0);
    run_adb(vec!["install", "-r", "-d", &apks[0].to_string_lossy()]).map_err(|e| { log(&e, "error", 10.0); e })?;
    log("CtsVerifier.apk installed", "success", 30.0);
    run_adb(vec!["install", "-r", "-d", &apks[1].to_string_lossy()]).map_err(|e| { log(&e, "error", 40.0); e })?;
    log("CtsPermissionApp.apk installed", "success", 60.0);
    run_adb(vec!["install", "-r", "-t", &apks[2].to_string_lossy()]).map_err(|e| { log(&e, "error", 70.0); e })?;
    log("CtsEmptyDeviceOwner.apk installed", "success", 80.0);
    let _ = run_adb(vec!["shell", "dpm", "set-device-owner", "--user", "0", "com.android.cts.emptydeviceowner/.EmptyDeviceAdmin"]);
    let _ = run_adb(vec!["shell", "appops", "set", "com.android.cts.verifier", "android:read_device_identifiers", "allow"]);
    let _ = run_adb(vec!["shell", "appops", "set", "com.android.cts.verifier", "MANAGE_EXTERNAL_STORAGE", "0"]);
    log("DONE", "success", 100.0);
    Ok(())
}

fn main() {
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_devices, run_install_sequence])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
