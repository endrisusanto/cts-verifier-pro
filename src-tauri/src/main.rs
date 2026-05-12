// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use tauri::State;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Deserialize, Clone)]
struct Device {
    id: String, status: String, model: String, version: String, sdk: String, security_patch: String,
    carrier: String, region: String, pda: String, sw_ver: String, csc: String,
}

#[derive(Serialize, Clone)]
struct LogPayload {
    device_id: String, message: String, status: String, progress: f32,
}

struct AppState {
    should_stop: Arc<AtomicBool>,
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn execute_adb(device_id: &str, args: Vec<&str>) -> Result<String, String> {
    let mut final_args = vec!["-s", device_id];
    final_args.extend(args);
    let mut cmd = Command::new("adb");
    cmd.args(&final_args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("ADB error: {}", e))?;
    if output.status.success() { Ok(String::from_utf8_lossy(&output.stdout).to_string()) }
    else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
}

fn execute_adb_best_effort(device_id: &str, args: Vec<&str>) -> String {
    execute_adb(device_id, args).unwrap_or_default().trim().to_string()
}

fn normalize_android_resource_version(release: &str, oneui: &str) -> String {
    let oneui_version = oneui.trim().parse::<u32>().unwrap_or(0);
    let release = release.trim();

    if release.starts_with("16") && oneui_version >= 80500 {
        "16.1".to_string()
    } else if release.starts_with("16") {
        "16".to_string()
    } else if release.starts_with("15") {
        "15".to_string()
    } else if release.starts_with("14") {
        "14".to_string()
    } else {
        release.split('.').next().unwrap_or("15").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_android_resource_version;

    #[test]
    fn detects_samsung_android_16_1_from_oneui_85() {
        assert_eq!(normalize_android_resource_version("16", "80500"), "16.1");
    }

    #[test]
    fn keeps_plain_android_16_on_older_oneui() {
        assert_eq!(normalize_android_resource_version("16", "80000"), "16");
    }
}

fn resolve_apk_resource_path(app: &AppHandle, device_id: &str, plan: &str) -> Result<(PathBuf, String), String> {
    let release = execute_adb_best_effort(device_id, vec!["shell", "getprop", "ro.build.version.release"]);
    let oneui = execute_adb_best_effort(device_id, vec!["shell", "getprop", "ro.build.version.oneui"]);
    let normalized = normalize_android_resource_version(&release, &oneui);
    
    let plan_folder = if plan.to_lowercase() == "normal" { "Normal" } else { "Full" };
    let base_path = app.path().resolve(format!("apks/{}", plan_folder), BaseDirectory::Resource).map_err(|e| format!("Resource error: {}", e))?;

    let normalized_path = base_path.join(&normalized);
    if normalized_path.exists() {
        return Ok((normalized_path, format!("{}/{}", plan_folder, normalized)));
    }

    let release_major = release.split('.').next().unwrap_or("15");
    let release_path = base_path.join(release_major);
    if release_path.exists() {
        return Ok((release_path, format!("{}/{}", plan_folder, release_major)));
    }

    Ok((base_path, format!("{}/default", plan_folder)))
}

fn install_apk(device_id: &str, apk_path: &Path, extra_flags: &[&str]) -> Result<(), String> {
    if !apk_path.exists() {
        return Err(format!("Missing APK: {}", apk_path.display()));
    }

    let apk = apk_path.to_string_lossy();
    let mut args = vec!["install", "-r", "-d"];
    args.extend(extra_flags.iter().copied());
    args.push(&apk);
    execute_adb(device_id, args).map(|_| ())
}

fn install_optional_apk(device_id: &str, apk_path: &Path) {
    if apk_path.exists() {
        let _ = install_apk(device_id, apk_path, &["-g", "-t"]);
    }
}

#[tauri::command]
fn emergency_stop(state: tauri::State<'_, AppState>) {
    state.should_stop.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
async fn get_devices() -> Result<Vec<Device>, String> {
    let mut cmd = Command::new("adb");
    cmd.arg("devices");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| e.to_string())?;
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
                    sdk: props.get("ro.system.build.version.sdk_full")
                        .filter(|v| !v.is_empty())
                        .or_else(|| props.get("ro.build.version.sdk"))
                        .cloned()
                        .unwrap_or_default(),
                    security_patch: props.get("ro.build.version.security_patch").cloned().unwrap_or_default(),
                    carrier: props.get("ro.csc.sales_code").cloned().unwrap_or_default(),
                    region: props.get("ro.csc.country_code").cloned().unwrap_or_default(),
                    pda: props.get("ro.build.PDA").cloned().unwrap_or_default(),
                    sw_ver: props.get("ril.sw_ver").cloned().unwrap_or_default(),
                    csc: props.get("ril.official_cscver").cloned().unwrap_or_default(),
                });
            } else { devices.push(Device { id, status, ..Default::default() }); }
        }
    }
    Ok(devices)
}

fn get_device_props(device_id: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let props = vec![
        "ro.product.model",
        "ro.build.version.release",
        "ro.build.version.sdk",
        "ro.system.build.version.sdk_full",
        "ro.build.version.security_patch",
        "ro.csc.sales_code",
        "ro.csc.country_code",
        "ro.build.PDA",
        "ril.sw_ver",
        "ril.official_cscver",
        "ro.build.version.oneui",
    ];
    for prop in props {
        if let Ok(out) = execute_adb(device_id, vec!["shell", "getprop", prop]) {
            map.insert(prop.to_string(), out.trim().to_string());
        }
    }
    map
}

impl Default for Device {
    fn default() -> Self {
        Self { id: "".into(), status: "".into(), model: "Unknown".into(), version: "".into(), sdk: "".into(), security_patch: "".into(), carrier: "".into(), region: "".into(), pda: "".into(), sw_ver: "".into(), csc: "".into() }
    }
}

fn grant_permissions(device_id: &str) {
    let perms = vec![
        "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.CAMERA", "android.permission.RECORD_AUDIO",
        "android.permission.READ_CONTACTS", "android.permission.READ_PHONE_STATE",
        "android.permission.POST_NOTIFICATIONS", "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN", "android.permission.NEARBY_WIFI_DEVICES",
    ];
    for perm in perms {
        let _ = execute_adb(device_id, vec!["shell", "pm", "grant", "com.android.cts.verifier", perm]);
    }
}

#[tauri::command]
async fn run_install_sequence(app: AppHandle, device_id: String, plan: String) -> Result<(), String> {
    let log = |msg: &str, stat: &str, prog: f32| {
        let _ = app.emit("install-log", LogPayload { device_id: device_id.clone(), message: msg.to_string(), status: stat.to_string(), progress: prog });
    };
    let release = execute_adb_best_effort(&device_id, vec!["shell", "getprop", "ro.build.version.release"]);
    let oneui = execute_adb_best_effort(&device_id, vec!["shell", "getprop", "ro.build.version.oneui"]);
    let (resource_path, resource_version) = resolve_apk_resource_path(&app, &device_id, &plan)?;
    log(
        &format!(
            "Detected Android {} / OneUI {} -> APK set {}",
            release,
            if oneui.is_empty() { "-" } else { &oneui },
            resource_version
        ),
        "info",
        5.0,
    );

    let apks = [
        resource_path.join("CtsVerifier.apk"), 
        resource_path.join("CtsPermissionApp.apk"), 
        resource_path.join("CtsEmptyDeviceOwner.apk"),
        app.path().resource_dir().unwrap().join("apks/ApkTest/AutoCtsVerifier-debug.apk"),
        app.path().resource_dir().unwrap().join("apks/ApkTest/AutoCtsVerifier-debug-androidTest.apk")
    ];
    log("Installing APKs...", "info", 10.0);
    install_apk(&device_id, &apks[0], &["-g", "-t"])?;
    install_apk(&device_id, &apks[1], &["-g", "-t"])?;
    install_apk(&device_id, &apks[2], &["-t"])?;
    install_apk(&device_id, &apks[3], &["-t", "-g"])?;
    install_apk(&device_id, &apks[4], &["-t", "-g"])?;

    log("Installing companion APKs when available...", "info", 45.0);
    for apk in [
        "CtsEmptyDeviceAdmin.apk",
        "CtsDeviceControlsApp.apk",
        "CtsDefaultNotesApp.apk",
        "CtsCarWatchdogCompanionApp.apk",
        "CrossProfileTestApp.apk",
        "CtsForceStopHelper.apk",
        "CtsTileServiceApp.apk",
        "NotificationBot.apk",
        "CtsVerifierInstantApp.apk",
        "CtsVerifierUSBCompanion.apk",
        "CtsTtsEngineSelectorTestHelper.apk",
        "CtsTtsEngineSelectorTestHelper2.apk",
        "CtsVpnFirewallAppApi23.apk",
        "CtsVpnFirewallAppApi24.apk",
        "CtsVpnFirewallAppNotAlwaysOn.apk",
        "jetpack-camera-app.apk",
        "CameraFeatureCombinationVerifier.apk",
    ] {
        install_optional_apk(&device_id, &resource_path.join(apk));
    }

    log("Setting Device Owner...", "info", 60.0);
    let _ = execute_adb(&device_id, vec!["shell", "dpm", "set-device-owner", "--user", "0", "com.android.cts.emptydeviceowner/.EmptyDeviceAdmin"]);
    log("Granting industrial permissions...", "info", 80.0);
    grant_permissions(&device_id);
    let _ = execute_adb(&device_id, vec!["shell", "appops", "set", "com.android.cts.verifier", "android:read_device_identifiers", "allow"]);
    let _ = execute_adb(&device_id, vec!["shell", "appops", "set", "com.android.cts.verifier", "MANAGE_EXTERNAL_STORAGE", "allow"]);
    let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "global", "verifier_verify_adb_installs", "0"]);
    let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "global", "device_name", &device_id]);
    log("Installation Complete", "success", 100.0);
    Ok(())
}

#[tauri::command]
async fn pull_results(device_id: String, folder_name: Option<String>, base_path: Option<String>) -> Result<String, String> {
    let base = base_path.unwrap_or_else(|| "results".to_string());
    let name = folder_name.unwrap_or(device_id.clone());
    let target_dir = PathBuf::from(base).join(&name);
    let _ = std::fs::create_dir_all(&target_dir);
    
    // Force sync filesystem on device to ensure ZIPs are flushed
    let _ = execute_adb(&device_id, vec!["shell", "sync"]);
    
    // Pull contents of both possible folder names directly into target_dir
    // Using /. ensures we pull the contents, not the folder itself
    let _ = execute_adb(&device_id, vec!["pull", "/sdcard/verifierReports/.", &target_dir.to_string_lossy()]);
    let _ = execute_adb(&device_id, vec!["pull", "/sdcard/VerifierReports/.", &target_dir.to_string_lossy()]);
    let _ = execute_adb(&device_id, vec!["pull", "/storage/emulated/0/verifierReports/.", &target_dir.to_string_lossy()]);
    let _ = execute_adb(&device_id, vec!["pull", "/storage/emulated/0/VerifierReports/.", &target_dir.to_string_lossy()]);
    
    Ok(target_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn open_folder(device_id: String, folder_name: Option<String>, base_path: Option<String>) -> Result<(), String> {
    let base = base_path.unwrap_or_else(|| "results".to_string());
    let name = folder_name.unwrap_or(device_id.clone());
    let target_dir = PathBuf::from(base).join(&name);
    let _ = std::fs::create_dir_all(&target_dir);
    
    // We use xdg-open for Linux.
    let _ = std::process::Command::new("xdg-open")
        .arg(&target_dir)
        .spawn();
        
    Ok(())
}

#[tauri::command]
fn identify_device(device_id: String, brighten: bool) -> Result<(), String> {
    if brighten {
        // Wake device and press home
        let _ = execute_adb(&device_id, vec!["shell", "input", "keyevent", "224"]); // KEYCODE_WAKEUP
        let _ = execute_adb(&device_id, vec!["shell", "input", "keyevent", "3"]);   // KEYCODE_HOME
        // Set manual brightness mode
        let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "system", "screen_brightness_mode", "0"]);
        // Maximize brightness (255)
        let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "system", "screen_brightness", "255"]);
        // Set screen timeout to 10 minutes (600000 ms)
        let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "system", "screen_off_timeout", "600000"]);
    } else {
        // Dim the device
        let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "system", "screen_brightness_mode", "0"]);
        let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "system", "screen_brightness", "10"]);
        // Restore screen timeout to 1 minute (60000 ms)
        let _ = execute_adb(&device_id, vec!["shell", "settings", "put", "system", "screen_off_timeout", "60000"]);
    }
    Ok(())
}



#[tauri::command]
async fn run_instrumentation_test(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: String,
    test_class: String,
) -> Result<String, String> {
    state.should_stop.store(false, Ordering::SeqCst);
    let mut final_status = "Done".to_string();
    
    let log = |msg: &str, stat: &str, prog: f32| {
        let _ = app.emit("install-log", LogPayload {
            device_id: device_id.clone(),
            message: msg.to_string(),
            status: stat.to_string(),
            progress: prog,
        });
    };

    log(&format!("Starting instrumentation test: {}", test_class), "info", 10.0);

    let mut cmd = AsyncCommand::new("adb");
    cmd.args(&[
        "-s", &device_id,
        "shell", "am", "instrument", "-w", "-r", "-e", "debug", "false",
        "-e", "class", &test_class,
        "com.example.autoctsver.test/androidx.test.runner.AndroidJUnitRunner"
    ]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to spawn adb: {}", e)),
    };

    let stdout = child.stdout.take().expect("Failed to open stdout");
    let mut reader = BufReader::new(stdout).lines();

    let mut current_progress = 10.0;

    while let Ok(Some(line)) = reader.next_line().await {
        if state.should_stop.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            return Err("Stopped by user".to_string());
        }

        let trimmed = line.trim();
        println!("[{}] {}", device_id, trimmed);

        if trimmed.starts_with("INSTRUMENTATION_STATUS: result=") {
            let result = trimmed.strip_prefix("INSTRUMENTATION_STATUS: result=").unwrap_or("").trim();
            final_status = result.to_string();
            log(&format!("Test Result: {}", result), if result == "Pass" { "success" } else { "error" }, 100.0);
        } else if trimmed.starts_with("INSTRUMENTATION_STATUS: testcase=") {
            let info = trimmed.strip_prefix("INSTRUMENTATION_STATUS: testcase=").unwrap_or("").trim();
            log(&format!("Running testcase: {}", info), "info", current_progress);
            if current_progress < 90.0 { current_progress += 5.0; }
        } else if trimmed.starts_with("INSTRUMENTATION_STATUS: cmd=") {
            let cmd_str = trimmed.strip_prefix("INSTRUMENTATION_STATUS: cmd=").unwrap_or("").trim();
            log(&format!("Executing host command: {}", cmd_str), "info", current_progress);
        } else if trimmed.starts_with("INSTRUMENTATION_RESULT") || trimmed.starts_with("INSTRUMENTATION_CODE") {
             // End of instrumentation
             log("Instrumentation finished", "info", 100.0);
        }
    }

    let _ = child.wait().await;
    Ok(final_status)
}

fn main() {
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { should_stop: Arc::new(AtomicBool::new(false)) })
        .invoke_handler(tauri::generate_handler![get_devices, run_install_sequence, pull_results, open_folder, emergency_stop, identify_device, run_instrumentation_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
