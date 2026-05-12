window.addEventListener("DOMContentLoaded", () => {
  console.log("DOM Content Loaded - Initializing...");
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const { open } = window.__TAURI__.dialog;

  const deviceListEl = document.getElementById("device-list");
  const refreshBtn = document.getElementById("refresh-btn");
  const runRealTestBtn = document.getElementById("run-real-test");
  const stopBtn = document.getElementById("emergency-stop");
  const toggleAllBtn = document.getElementById("toggle-all");
  const logOutput = document.getElementById("log-output");
  const appStatus = document.getElementById("app-status");
  const errorModal = document.getElementById("error-modal");
  const errorMessage = document.getElementById("error-message");
  const getTestcasesBtn = document.getElementById("get-testcases-btn");
  const taskSelector = document.getElementById("task-selector");
  const skipPreconditions = document.getElementById("skip-preconditions");
  const getResultsBtn = document.getElementById("get-results-btn");
  const clearLogBtn = document.getElementById("clear-log-btn");
  const checklistBody = document.getElementById("checklist-body");

  // Settings Elements
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const resultsPathInput = document.getElementById("results-path-input");
  const browsePathBtn = document.getElementById("browse-path-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");

  let devices = [];
  let checkedDevices = new Set();
  let isAllSelected = false;

  // --- Settings Logic ---
  let customResultsPath = localStorage.getItem("resultsPath") || "";

  resultsPathInput.value = customResultsPath;

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
    localStorage.setItem("resultsPath", customResultsPath);

    settingsModal.style.display = "none";
    appendLog("SYSTEM", `Settings saved. Results path: ${customResultsPath || './results'}`, "success");
  });

  clearLogBtn.addEventListener("click", () => {
    logOutput.innerHTML = "";
    appendLog("SYSTEM", "Log cleared.", "info");
  });

  // Force hide modal on startup
  if (errorModal) errorModal.style.display = "none";
  if (settingsModal) settingsModal.style.display = "none";

  // --- Fetch Test Cases Data ---
  let testCaseAvailable = null;
  let testCaseToActivity = null;

  async function loadTestCasesData() {
    try {
      const res1 = await fetch("assets/ListTestCaseAvailable.json");
      testCaseAvailable = await res1.json();
      const res2 = await fetch("assets/TestCaseToActivity.json");
      testCaseToActivity = await res2.json();
    } catch (err) {
      appendLog("SYSTEM", "Failed to load test case JSON: " + err, "error");
    }
  }
  loadTestCasesData();

  getTestcasesBtn.addEventListener("click", () => {
    if (checkedDevices.size === 0) {
      showError("Please select at least one device first.");
      return;
    }
    if (!testCaseAvailable || !testCaseToActivity) {
      showError("Test case data is still loading or failed to load.");
      return;
    }
    
    checklistBody.innerHTML = "";
    const task = taskSelector.value;
    const allTests = testCaseAvailable.CtsVerModule || [];
    
    let filteredTests = [];
    filteredTests = allTests.filter(t => t === "BYODManagedProvisioningNormal" || t === "DeviceOwnerTestsNormal");

    // Map to activity using TestCaseToActivity.json
    // The keys in TestCaseToActivity often have spaces (e.g. "Device Owner Tests") while ListTestCaseAvailable has no spaces.
    // Let's do a loose matching or known mapping
    const normalizedToKeys = Object.keys(testCaseToActivity).map(k => ({
      original: k,
      stripped: k.replace(/\s+/g, '')
    }));

    let count = 0;
    filteredTests.forEach((tc) => {
      // Find matching activity
      let activity = "";
      if (tc === "BYODManagedProvisioningNormal" || tc === "BYODManagedProvisioning") {
         activity = testCaseToActivity["BYOD Provisioning tests"];
      } else if (tc === "DeviceOwnerTestsNormal" || tc === "DeviceOwnerTests") {
         activity = testCaseToActivity["Device Owner Tests"];
      } else {
         const match = normalizedToKeys.find(m => m.stripped.toLowerCase() === tc.toLowerCase());
         if (match) activity = testCaseToActivity[match.original];
      }
      
      if (!activity) {
         // Skip tests that don't have a direct activity mapping in the JSON
         return;
      }

      count++;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align: center;">
          <label class="cb-container" style="display: inline-block; width: 16px; height: 16px;">
            <input type="checkbox" checked class="tc-checkbox" data-activity="${activity}">
            <svg class="checkmark-svg" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
              <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" fill="none"/>
              <path d="M7 12l3 3 7-7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </label>
        </td>
        <td style="font-family: monospace; color: #ccc;">${tc}</td>
        <td style="font-weight: bold; color: #555;" class="tc-result">-</td>
        <td style="color: #666;" class="tc-time">-</td>
      `;
      checklistBody.appendChild(tr);
    });
    appendLog("SYSTEM", `Loaded ${count} test cases for Task ${task.toUpperCase()}.`, "success");
  });

  // --- Core App Logic ---
  async function refreshDevices(isManual = false) {
    if (isManual) appendLog("SYSTEM", "User requested device refresh...", "info");
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
        updateRunButton();
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
    if (!logOutput) return;
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
    if (refreshBtn) refreshBtn.disabled = loading;
    if (getResultsBtn) getResultsBtn.disabled = loading;
    if (runRealTestBtn) runRealTestBtn.disabled = loading;
    if (settingsBtn) settingsBtn.disabled = loading;
    if (stopBtn) stopBtn.style.display = loading ? "inline-block" : "none";
    if (appStatus) appStatus.textContent = statusText;
    if (!loading) updateRunButton();
  }

  function updateRunButton() {
    const hasSelection = checkedDevices.size > 0;
    getResultsBtn.disabled = !hasSelection;
    runRealTestBtn.disabled = !hasSelection;
    runRealTestBtn.textContent = `Run Selected (${checkedDevices.size})`;
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
    updateRunButton();
  });


  async function startRealInstrumentation() {
    const selectedIds = Array.from(checkedDevices);
    
    // Get selected tests from table
    const selectedTests = [];
    document.querySelectorAll('.tc-checkbox:checked').forEach(cb => {
       selectedTests.push(cb.getAttribute('data-activity'));
    });

    if (selectedTests.length === 0) {
      showError("Please check at least one testcase to run.");
      return;
    }

    setLoadingState(true, "Running Real Tests...");
    appendLog("SYSTEM", `Starting real instrumentation on ${selectedIds.length} devices for ${selectedTests.length} tests...`, "info");

    const planStr = "normal";

    const promises = selectedIds.map(async (id) => {
      // 1. Run Preconditions if not skipped
      if (!skipPreconditions.checked) {
        appendLog(id, "Running Preconditions (Install & Setup)...", "info");
        try {
          await invoke("run_install_sequence", { deviceId: id, plan: planStr });
        } catch(err) {
          appendLog(id, "Preconditions failed: " + err, "error");
          // we might want to continue or stop? usually we continue or fail device. Let's continue.
        }
      }

      // 2. Run selected tests
      for (const testClass of selectedTests) {
         // Find row in table for this test
         const row = Array.from(document.querySelectorAll('#checklist-body tr')).find(r => 
           r.querySelector('.tc-checkbox')?.dataset.activity === testClass
         );
         const resultCell = row?.querySelector('.tc-result');
         const timeCell = row?.querySelector('.tc-time');
         
         if (resultCell) {
            resultCell.textContent = "RUNNING";
            resultCell.style.color = "#4285f4";
         }
         
         const startTime = Date.now();
         try {
           const resultStatus = await invoke("run_instrumentation_test", {
             deviceId: id,
             testClass: testClass
           });
           
           if (resultCell) {
              resultCell.textContent = resultStatus ? resultStatus.toUpperCase() : "DONE";
              if (resultStatus === "Pass") resultCell.style.color = "#3ddc84";
              else if (resultStatus === "Fail") resultCell.style.color = "#ff4d4d";
              else resultCell.style.color = "#888";
           }
         } catch(err) {
           appendLog(id, `Test Failed: ${err}`, "error");
           if (resultCell) {
              resultCell.textContent = "ERROR";
              resultCell.style.color = "#ff4d4d";
           }
         } finally {
           if (timeCell) {
              const duration = ((Date.now() - startTime) / 1000).toFixed(1);
              timeCell.textContent = `${duration}s`;
           }
         }
      }
    });

    await Promise.all(promises);
    setLoadingState(false);
  }

  async function startGetResults() {
    const selectedIds = Array.from(checkedDevices);
    setLoadingState(true, "Pulling Results...");
    appendLog("SYSTEM", `Pulling results for ${selectedIds.length} devices...`, "info");

    const promises = selectedIds.map(async (id) => {
      const deviceObj = devices.find(d => d.id === id);
      try {
        const path = await invoke("pull_results", {
          deviceId: id,
          folderName: deviceObj ? getFolderName(deviceObj) : null,
          basePath: customResultsPath || null
        });
        appendLog(id, `Results saved to: ${path}`, "success");
      } catch(err) {
        appendLog(id, `Failed to pull results: ${err}`, "error");
      }
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

  runRealTestBtn.addEventListener("click", startRealInstrumentation);
  getResultsBtn.addEventListener("click", startGetResults);
  stopBtn.addEventListener("click", () => {
    invoke("emergency_stop");
    appendLog("SYSTEM", "Emergency Stop Requested!", "error");
  });
  refreshBtn.addEventListener("click", () => refreshDevices(true));

  refreshDevices(false);
});
