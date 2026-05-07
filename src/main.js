window.addEventListener("DOMContentLoaded", () => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  const deviceListEl = document.getElementById("device-list");
  const refreshBtn = document.getElementById("refresh-btn");
  const installBtn = document.getElementById("install-selected");
  const toggleAllBtn = document.getElementById("toggle-all");
  const logOutput = document.getElementById("log-output");
  const appStatus = document.getElementById("app-status");
  const errorModal = document.getElementById("error-modal");
  const errorMessage = document.getElementById("error-message");

  let devices = [];
  let checkedDevices = new Set();
  let isAllSelected = false;

  async function refreshDevices() {
    refreshBtn.disabled = true;
    appStatus.textContent = "Scanning...";
    try {
      devices = await invoke("get_devices");
      renderDevices();
    } catch (error) {
      appendLog("SYSTEM", `Scan failed: ${error}`, "error");
    } finally {
      refreshBtn.disabled = false;
      appStatus.textContent = "Standby";
      updateInstallButton();
    }
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
          <div class="card-content" style="min-width: 0; flex: 1;">
            <div class="device-id" style="color: var(--text-primary); font-size: 0.95rem;">${device.model || 'Unknown Device'}</div>
            <div class="device-meta">
              <span style="color: var(--blue); font-weight: 700;">${device.id}</span> • 
              Android Version ${device.version || '?'} (SDK ${device.sdk || '?'}) • 
              <span style="color: ${device.status === 'device' ? '#3ddc84' : '#ff4d4d'}">${device.status}</span>
            </div>
          </div>
        </div>

        <div class="device-details-grid">
          <div class="detail-item"><span class="detail-label">SEC</span><span class="detail-value">${device.security_patch || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">CARRIER</span><span class="detail-value">${device.carrier || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">REGION</span><span class="detail-value">${device.region || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">PDA</span><span class="detail-value">${device.pda || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">SW VER</span><span class="detail-value">${device.sw_ver || '-'}</span></div>
          <div class="detail-item"><span class="detail-label">CSC VERSION</span><span class="detail-value">${device.csc || '-'}</span></div>
        </div>
      `;

      const checkbox = card.querySelector('input');

      // Helper to toggle state
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

      // Click event for the whole card
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking the checkbox directly (to avoid double toggle)
        if (e.target !== checkbox) {
          toggleState();
        }
      });

      // Checkbox specific change
      checkbox.addEventListener('change', (e) => {
        toggleState(e.target.checked);
      });

      deviceListEl.appendChild(card);
    });
  }

  function updateInstallButton() {
    installBtn.disabled = checkedDevices.size === 0;
    installBtn.textContent = `Install (${checkedDevices.size})`;
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
    installBtn.disabled = true;
    refreshBtn.disabled = true;
    toggleAllBtn.disabled = true;
    appStatus.textContent = "Installing...";

    logOutput.innerHTML = "";
    appendLog("SYSTEM", `Starting parallel installation on ${selectedIds.length} devices...`, "info");

    let hasErrors = false;
    let lastError = "";

    const promises = selectedIds.map(id =>
      invoke("run_install_sequence", { deviceId: id })
        .catch(err => {
          hasErrors = true;
          lastError = err;
          appendLog(id, err, "error");
        })
    );

    await Promise.all(promises);

    if (hasErrors) {
      errorMessage.textContent = `Installation errors detected.\n\nError: ${lastError}`;
      errorModal.style.display = "flex";
    }

    appendLog("SYSTEM", "Installation finished.", "success");
    installBtn.disabled = false;
    refreshBtn.disabled = false;
    toggleAllBtn.disabled = false;
    appStatus.textContent = "Standby";
  }

  function appendLog(deviceId, message, status) {
    const line = document.createElement("div");
    line.className = `log-line log-${status}`;
    line.innerHTML = `<span class="log-device">[${deviceId}]</span> ${message}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  listen("install-log", (event) => {
    const { device_id, message, status, progress } = event.payload;
    const fill = document.getElementById(`progress-${device_id}`);
    if (fill) {
      fill.style.width = `${progress}%`;
      if (status === "error") fill.style.background = "rgba(255, 77, 77, 0.1)";
    }
    appendLog(device_id, message, status);
  });

  installBtn.addEventListener("click", startParallelInstall);
  refreshBtn.addEventListener("click", refreshDevices);

  refreshDevices();
});
