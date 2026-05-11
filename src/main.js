window.addEventListener("DOMContentLoaded", () => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const { open } = window.__TAURI__.dialog;

  const deviceListEl = document.getElementById("device-list");
  const refreshBtn = document.getElementById("refresh-btn");
  const installBtn = document.getElementById("install-selected");
  const passBtn = document.getElementById("pass-selected");
  const stopBtn = document.getElementById("emergency-stop");
  const toggleAllBtn = document.getElementById("toggle-all");
  const logOutput = document.getElementById("log-output");
  const appStatus = document.getElementById("app-status");
  const errorModal = document.getElementById("error-modal");
  const errorMessage = document.getElementById("error-message");
  const consoleEl = document.getElementById("resizable-console");
  const resizer = document.getElementById("console-resizer");
  const clearLogBtn = document.getElementById("clear-log-btn");

  // Settings Elements
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const resultsPathInput = document.getElementById("results-path-input");
  const browsePathBtn = document.getElementById("browse-path-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const simpleModeSetting = document.getElementById("simple-mode-setting");
  const manualTapSetting = document.getElementById("manual-tap-setting");

  let devices = [];
  let checkedDevices = new Set();
  let isAllSelected = false;

  // --- Settings Logic ---
  let customResultsPath = localStorage.getItem("resultsPath") || "";
  let isSimpleMode = localStorage.getItem("simpleMode") === "true";
  let isManualTap = localStorage.getItem("manualTap") === "true";

  resultsPathInput.value = customResultsPath;
  simpleModeSetting.checked = isSimpleMode;
  manualTapSetting.checked = isManualTap;

  settingsBtn.addEventListener("click", () => {
    settingsModal.style.display = "flex";
  });

  browsePathBtn.addEventListener("click", async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Results Folder"
    });
    if (selected) {
      resultsPathInput.value = selected;
    }
  });

  saveSettingsBtn.addEventListener("click", () => {
    customResultsPath = resultsPathInput.value;
    isSimpleMode = simpleModeSetting.checked;
    isManualTap = manualTapSetting.checked;

    localStorage.setItem("resultsPath", customResultsPath);
    localStorage.setItem("simpleMode", isSimpleMode);
    localStorage.setItem("manualTap", isManualTap);

    settingsModal.style.display = "none";
    appendLog("SYSTEM", `Settings saved. Results path: ${customResultsPath || './results'}, Simple Mode: ${isSimpleMode}`, "success");
  });

  clearLogBtn.addEventListener("click", () => {
    logOutput.innerHTML = "";
    appendLog("SYSTEM", "Log cleared.", "info");
  });

  // Force hide modal on startup
  errorModal.style.display = "none";
  settingsModal.style.display = "none";

  // --- Resizable Console Logic ---
  let isResizing = false;
  resizer.addEventListener("mousedown", () => { isResizing = true; document.body.style.cursor = "ns-resize"; });
  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const height = window.innerHeight - e.clientY;
    if (height > 40 && height < window.innerHeight * 0.8) consoleEl.style.height = `${height}px`;
  });
  document.addEventListener("mouseup", () => { isResizing = false; document.body.style.cursor = "default"; });

  // --- Core App Logic ---
  async function refreshDevices(isManual = false) {
    setLoadingState(true, "Scanning...");
    appendLog("SYSTEM", "Scanning for Android devices via ADB...", "info");
    try {
      devices = await invoke("get_devices");
      appendLog("SYSTEM", `Scan complete. Found ${devices.length} device(s).`, devices.length > 0 ? "success" : "info");
      renderDevices();
    } catch (error) {
      appendLog("SYSTEM", `ADB Scan Error: ${error}`, "error");
      if (isManual) showError(`Failed to scan devices: ${error}`);
    } finally {
      setLoadingState(false);
    }
  }

  function getFolderName(device) {
    const model = (device.model || "Unknown").replace(/[^a-zA-Z0-9-]/g, "_");
    const pda = (device.pda || "Unknown").replace(/[^a-zA-Z0-9-]/g, "_");
    return `${device.id}_${model}_${pda}`;
  }

  function renderDevices() {
    deviceListEl.innerHTML = "";
    if (devices.length === 0) {
      deviceListEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #444; padding-top: 40px; font-size: 0.8rem;">No devices connected</div>`;
      return;
    }

    devices.forEach(device => {
      const isChecked = checkedDevices.has(device.id);
      const card = document.createElement("div");
      card.className = `device-card ${isChecked ? 'checked' : ''}`;
      card.id = `card-${device.id}`;

      card.innerHTML = `
        <div class="progress-fill" id="progress-${device.id}"></div>
        <div class="device-card-top">
          <label class="cb-container">
            <input type="checkbox" ${isChecked ? 'checked' : ''} data-id="${device.id}">
            <svg class="checkmark-svg" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.05)" fill="none"/>
              <path d="M7 12l3 3 7-7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </label>
          <div class="card-content">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div class="device-id" style="color: var(--text-primary); font-size: 0.95rem; font-weight: 700;">${device.model || 'Unknown Device'}</div>
              <div>
                <button class="btn-identify" data-id="${device.id}" style="background: rgba(128, 128, 128, 0.1); border: 1px solid rgba(128, 128, 128, 0.3); color: #888; padding: 2px 6px; border-radius: 4px; font-size: 0.6rem; cursor: pointer; margin-right: 4px;" title="Identify Device">💡</button>
                <button class="btn-save-zip" data-id="${device.id}" style="background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.3); color: #58a6ff; padding: 2px 6px; border-radius: 4px; font-size: 0.6rem; cursor: pointer; text-transform: uppercase; font-weight: bold;">Result</button>
              </div>
            </div>
            <div class="device-meta">
              <span style="color: var(--blue); font-weight: 700;">${device.id}</span> • 
              Android ${device.version || '?'} • 
              <span style="color: ${device.status === 'device' ? '#3ddc84' : '#ff4d4d'}">${device.status}</span>
            </div>
          </div>
        </div>

        <div class="device-details-grid">
          <div class="detail-item"><span class="detail-label">SPL</span><span class="detail-value">${device.security_patch || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">CARRIER</span><span class="detail-value">${device.carrier || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">REGION</span><span class="detail-value">${device.region || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">PDA</span><span class="detail-value">${device.pda || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">MODEM</span><span class="detail-value">${device.sw_ver || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">CSC</span><span class="detail-value">${device.csc || '-'}</span></div>
        </div>
      `;

      const checkbox = card.querySelector('input');
      const saveBtn = card.querySelector('.btn-save-zip');
      const identifyBtn = card.querySelector('.btn-identify');

      const toggleState = (forceState) => {
        const newState = forceState !== undefined ? forceState : !checkedDevices.has(device.id);
        if (newState) {
          checkedDevices.add(device.id);
          card.classList.add('checked');
          checkbox.checked = true;
        } else {
          checkedDevices.delete(device.id);
          card.classList.remove('checked');
          checkbox.checked = false;
        }
        updateInstallButton();
      };

      card.addEventListener('click', (e) => {
        if (e.target !== checkbox && !e.target.closest('.cb-container') && e.target !== saveBtn && e.target !== identifyBtn) toggleState();
      });

      checkbox.addEventListener('change', (e) => {
        toggleState(e.target.checked);
      });

      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        saveBtn.textContent = "...";
        try {
          await invoke("open_folder", {
            deviceId: device.id,
            folderName: getFolderName(device),
            basePath: customResultsPath || null
          });
          saveBtn.textContent = "Opened";
          setTimeout(() => saveBtn.textContent = "Folder", 2000);
        } catch (err) {
          appendLog(device.id, `Failed to open folder: ${err}`, "error");
          saveBtn.textContent = "Error";
          setTimeout(() => saveBtn.textContent = "Folder", 2000);
        }
      });

      let isBright = false;
      identifyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        identifyBtn.style.opacity = '0.5';
        isBright = !isBright;
        try {
          await invoke("identify_device", { deviceId: device.id, brighten: isBright });
          if (isBright) {
            identifyBtn.style.background = 'rgba(255, 179, 0, 0.2)';
            identifyBtn.style.borderColor = 'rgba(255, 179, 0, 0.5)';
            identifyBtn.style.color = '#ffb300';
            identifyBtn.title = "Dim Device";
            appendLog(device.id, "Device brightened (Timeout: 10m).", "info");
          } else {
            identifyBtn.style.background = 'rgba(128, 128, 128, 0.1)';
            identifyBtn.style.borderColor = 'rgba(128, 128, 128, 0.3)';
            identifyBtn.style.color = '#888';
            identifyBtn.title = "Identify Device";
            appendLog(device.id, "Device dimmed (Timeout: 1m).", "info");
          }
        } catch (err) {
          isBright = !isBright; // revert on fail
          appendLog(device.id, `Failed to toggle brightness: ${err}`, "error");
        }
        setTimeout(() => identifyBtn.style.opacity = '1', 500);
      });

      deviceListEl.appendChild(card);
    });
  }

  function appendLog(deviceId, message, status) {
    const line = document.createElement("div");
    line.className = `log-line log-${status}`;
    line.innerHTML = `<span class="log-device">[${deviceId}]</span> ${message}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorModal.style.display = "flex";
  }

  function setLoadingState(loading, statusText = "Standby") {
    refreshBtn.disabled = loading;
    installBtn.disabled = loading;
    passBtn.disabled = loading;
    toggleAllBtn.disabled = loading;
    settingsBtn.disabled = loading;
    stopBtn.style.display = loading ? "inline-block" : "none";
    appStatus.textContent = statusText;
    if (!loading) updateInstallButton();
  }

  function updateInstallButton() {
    const hasSelection = checkedDevices.size > 0;
    installBtn.disabled = !hasSelection;
    passBtn.disabled = !hasSelection;
    installBtn.textContent = `Install (${checkedDevices.size})`;
    passBtn.textContent = `Pass (${checkedDevices.size})`;
  }

  toggleAllBtn.addEventListener('click', () => {
    if (isAllSelected) {
      checkedDevices.clear();
      isAllSelected = false;
      toggleAllBtn.textContent = "Select";
    } else {
      devices.forEach(d => { if (d.status === 'device') checkedDevices.add(d.id); });
      isAllSelected = true;
      toggleAllBtn.textContent = "Unselect";
    }
    renderDevices();
    updateInstallButton();
  });

  async function startParallelInstall() {
    const selectedIds = Array.from(checkedDevices);
    const shouldAutoPass = document.getElementById("auto-pass-checkbox").checked;
    setLoadingState(true, shouldAutoPass ? "Installing & Passing..." : "Installing...");
    appendLog("SYSTEM", `Starting process on ${selectedIds.length} devices...`, "info");

    const promises = selectedIds.map(async (id) => {
      const deviceObj = devices.find(d => d.id === id);
      try {
        await invoke("run_install_sequence", { deviceId: id });
        if (shouldAutoPass) {
          await invoke("run_auto_pass_sequence", {
            deviceId: id,
            folderName: deviceObj ? getFolderName(deviceObj) : null,
            resultsPath: customResultsPath || null,
            simpleMode: isSimpleMode,
            manualTap: isManualTap
          });
        }
      } catch (err) {
        appendLog(id, err, "error");
        showError(`Sequence failed for ${id}: ${err}`);
      }
    });

    await Promise.all(promises);
    setLoadingState(false);
  }

  async function startManualPass() {
    const selectedIds = Array.from(checkedDevices);
    setLoadingState(true, "Auto Passing...");
    appendLog("SYSTEM", `Starting manual Auto-Pass on ${selectedIds.length} devices...`, "info");

    const promises = selectedIds.map(id => {
      const deviceObj = devices.find(d => d.id === id);
      return invoke("run_auto_pass_sequence", {
        deviceId: id,
        folderName: deviceObj ? getFolderName(deviceObj) : null,
        resultsPath: customResultsPath || null,
        simpleMode: isSimpleMode,
        manualTap: isManualTap
      }).catch(err => {
        appendLog(id, err, "error");
        showError(`Pass failed for ${id}: ${err}`);
      });
    });

    await Promise.all(promises);
    setLoadingState(false);
  }

  listen("install-log", (event) => {
    const { device_id, message, status, progress } = event.payload;
    const fill = document.getElementById(`progress-${device_id}`);
    if (fill) {
      fill.style.width = `${progress}%`;
      if (status === "error") fill.style.background = "rgba(255, 77, 77, 0.1)";
      else fill.style.background = "rgba(61, 220, 132, 0.15)";
    }
    appendLog(device_id, message, status);
  });

  installBtn.addEventListener("click", startParallelInstall);
  passBtn.addEventListener("click", startManualPass);
  stopBtn.addEventListener("click", () => {
    invoke("emergency_stop");
    appendLog("SYSTEM", "Emergency Stop Requested!", "error");
  });
  refreshBtn.addEventListener("click", () => refreshDevices(true));

  refreshDevices(false);
});
