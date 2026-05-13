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
  const retryCount = document.getElementById("retry-count");
  const clearLogBtn = document.getElementById("clear-log-btn");
  const checklistsContainer = document.getElementById("checklists-container");
  const summaryExecuted = document.getElementById("summary-executed");
  const summaryStarted = document.getElementById("summary-started");
  const summaryPass = document.getElementById("summary-pass");
  const summaryFail = document.getElementById("summary-fail");
  const summaryTime = document.getElementById("summary-time");
  const sidebarLogs = document.querySelector(".sidebar-logs");
  const sidebarLogsResizer = document.getElementById("sidebar-logs-resizer");

  // Settings Elements
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const resultsPathInput = document.getElementById("results-path-input");
  const browsePathBtn = document.getElementById("browse-path-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");

  let devices = [];
  let checkedDevices = new Set();
  let isAllSelected = false;
  let currentTestCases = [];
  let checklistState = new Map();
  let runStartedAt = null;
  let isRunInProgress = false;

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

  function getNormalTestCases() {
    const allTests = testCaseAvailable?.CtsVerModule || [];
    const preferredOrder = ["DeviceOwnerTestsNormal", "BYODManagedProvisioningNormal"];
    const availableTests = new Set(allTests);
    const normalizedToKeys = Object.keys(testCaseToActivity || {}).map(k => ({
      original: k,
      stripped: k.replace(/\s+/g, '')
    }));

    return preferredOrder
      .filter(testcase => availableTests.has(testcase))
      .map((testcase) => {
        let activity = "";
        if (testcase === "BYODManagedProvisioningNormal" || testcase === "BYODManagedProvisioning") {
          activity = testCaseToActivity["BYOD Provisioning tests"];
        } else if (testcase === "DeviceOwnerTestsNormal" || testcase === "DeviceOwnerTests") {
          activity = testCaseToActivity["Device Owner Tests"];
        } else {
          const match = normalizedToKeys.find(m => m.stripped.toLowerCase() === testcase.toLowerCase());
          if (match) activity = testCaseToActivity[match.original];
        }
        return activity ? { testcase, activity } : null;
      })
      .filter(Boolean);
  }

  function createChecklistRow(deviceId, test) {
    const testState = checklistState.get(deviceId)?.get(test.testcase);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="text-align: center;">
        <label class="cb-container" style="display: inline-block; width: 16px; height: 16px;">
          <input type="checkbox" ${testState?.selected === false ? "" : "checked"} class="tc-checkbox" data-device-id="${deviceId}" data-testcase="${test.testcase}" data-activity="${test.activity}">
          <svg class="checkmark-svg" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" fill="none"/>
            <path d="M7 12l3 3 7-7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </label>
      </td>
      <td style="font-family: monospace; color: #ccc;">${test.testcase}</td>
      <td style="font-weight: bold; color: #555;" class="tc-result">${testState?.result || "-"}</td>
      <td style="color: #666;" class="tc-time">${testState?.time || "-"}</td>
    `;
    applyResultStyle(tr.querySelector(".tc-result"), testState?.result || "-");
    return tr;
  }

  function applyResultStyle(cell, status) {
    if (!cell) return;
    const normalized = (status || "-").toUpperCase();
    if (["PASS", "PASSED"].includes(normalized)) cell.style.color = "#3ddc84";
    else if (["FAIL", "FAILED", "ERROR"].includes(normalized)) cell.style.color = "#ff4d4d";
    else if (["RUNNING", "EXECUTING"].includes(normalized)) cell.style.color = "#4285f4";
    else cell.style.color = "#888";
  }

  function ensureChecklistState(tests) {
    const selectedIds = Array.from(checkedDevices);
    const nextState = new Map();

    selectedIds.forEach((deviceId) => {
      const prevTests = checklistState.get(deviceId) || new Map();
      const testEntries = new Map();
      tests.forEach((test) => {
        const previous = prevTests.get(test.testcase);
        testEntries.set(test.testcase, {
          testcase: test.testcase,
          activity: test.activity,
          selected: previous?.selected ?? true,
          result: previous?.result ?? "-",
          time: previous?.time ?? "-"
        });
      });
      nextState.set(deviceId, testEntries);
    });

    checklistState = nextState;
  }

  function renderDeviceChecklists(tests) {
    const selectedIds = Array.from(checkedDevices);
    ensureChecklistState(tests);
    checklistsContainer.innerHTML = "";
    if (selectedIds.length === 0 || tests.length === 0) {
      checklistsContainer.innerHTML = `<div class="empty-checklist">Select device(s) and click "Get Testcases"</div>`;
      return;
    }
    selectedIds.forEach((deviceId) => {
      const device = devices.find(d => d.id === deviceId);
      const card = document.createElement("section");
      card.className = "device-checklist-card";
      card.dataset.deviceId = deviceId;
      card.innerHTML = `
        <div class="device-checklist-header">
          <div>
            <div class="device-checklist-title">${device?.model || "Unknown Device"}</div>
            <div class="device-checklist-meta">${deviceId} • Android ${device?.version || "?"}</div>
          </div>
          <div class="device-checklist-meta">${tests.length} testcase(s)</div>
        </div>
        <table class="checklist-table">
          <thead>
            <tr>
              <th width="10%">Select</th>
              <th width="50%">Testcase</th>
              <th width="20%">Result</th>
              <th width="20%">Time</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      `;
      const body = card.querySelector("tbody");
      tests.forEach(test => body.appendChild(createChecklistRow(deviceId, test)));
      checklistsContainer.appendChild(card);
    });
  }

  function getSelectedTestsByDevice() {
    const testsByDevice = new Map();
    checklistState.forEach((tests, deviceId) => {
      const selectedTests = Array.from(tests.values())
        .filter((test) => test.selected)
        .map((test) => test.testcase);
      if (selectedTests.length > 0) testsByDevice.set(deviceId, selectedTests);
    });
    return testsByDevice;
  }

  function findChecklistRow(deviceId, testcase) {
    return Array.from(document.querySelectorAll(`.device-checklist-card[data-device-id="${deviceId}"] tbody tr`)).find(row =>
      row.querySelector('.tc-checkbox')?.dataset.testcase === testcase
    );
  }

  function formatRuntime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  function updateSummary() {
    const trackedTests = Array.from(checklistState.values()).flatMap((tests) => Array.from(tests.values()));
    const executed = trackedTests.filter((test) => !["-", "RUNNING", "EXECUTING"].includes((test.result || "-").toUpperCase())).length;
    const started = trackedTests.filter((test) => ["RUNNING", "EXECUTING"].includes((test.result || "-").toUpperCase())).length;
    const passed = trackedTests.filter((test) => ["PASS", "PASSED"].includes((test.result || "-").toUpperCase())).length;
    const failed = trackedTests.filter((test) => ["FAIL", "FAILED", "ERROR"].includes((test.result || "-").toUpperCase())).length;

    summaryExecuted.textContent = executed;
    summaryStarted.textContent = started;
    summaryPass.textContent = passed;
    summaryFail.textContent = failed;
    summaryTime.textContent = runStartedAt ? formatRuntime(Date.now() - runStartedAt) : "00:00:00";
  }

  getTestcasesBtn.addEventListener("click", () => {
    if (checkedDevices.size === 0) {
      showError("Please select at least one device first.");
      return;
    }
    if (!testCaseAvailable || !testCaseToActivity) {
      showError("Test case data is still loading or failed to load.");
      return;
    }
    const task = taskSelector.value;
    currentTestCases = getNormalTestCases();
    renderDeviceChecklists(currentTestCases);
    updateSummary();
    appendLog("SYSTEM", `Loaded ${currentTestCases.length} test cases per device for Task ${task.toUpperCase()}.`, "success");
    appendLog("SYSTEM", `Toolbar preset: task=${task}, skipPreconditions=${skipPreconditions.checked}, retry=${retryCount.value}`, "info");
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
        if (currentTestCases.length > 0) {
          renderDeviceChecklists(currentTestCases);
          updateSummary();
        }
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

  checklistsContainer.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".tc-checkbox");
    if (!checkbox) return;
    const tests = checklistState.get(checkbox.dataset.deviceId);
    const test = tests?.get(checkbox.dataset.testcase);
    if (!test) return;
    test.selected = checkbox.checked;
    updateSummary();
  });

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
    if (runRealTestBtn) runRealTestBtn.disabled = loading;
    if (settingsBtn) settingsBtn.disabled = loading;
    if (stopBtn) stopBtn.style.display = loading ? "inline-block" : "none";
    if (appStatus) appStatus.textContent = statusText;
    if (!loading) updateRunButton();
  }

  function updateRunButton() {
    const hasSelection = checkedDevices.size > 0;
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
    if (currentTestCases.length > 0) {
      renderDeviceChecklists(currentTestCases);
      updateSummary();
    }
    updateRunButton();
  });


  async function startRealInstrumentation() {
    if (isRunInProgress) {
      appendLog("SYSTEM", "Run request ignored because another run is still active.", "info");
      return;
    }

    const selectedIds = Array.from(checkedDevices);
    const testsByDevice = getSelectedTestsByDevice();

    if (testsByDevice.size === 0) {
      showError("Please check at least one testcase to run.");
      return;
    }

    isRunInProgress = true;
    setLoadingState(true, "Running Real Tests...");
    runStartedAt = Date.now();
    updateSummary();
    const totalSelectedTests = Array.from(testsByDevice.values()).reduce((sum, tests) => sum + tests.length, 0);
    appendLog("SYSTEM", `Starting real instrumentation on ${selectedIds.length} devices for ${totalSelectedTests} selected device-tests...`, "info");
    appendLog("SYSTEM", `Toolbar preset: task=${taskSelector.value}, skipPreconditions=${skipPreconditions.checked}, retry=${retryCount.value}, selectedDevices=${selectedIds.length}`, "info");

    const planStr = "normal";

    try {
      const promises = selectedIds.map(async (id) => {
      const selectedTests = testsByDevice.get(id) || [];
      if (selectedTests.length === 0) {
        appendLog(id, "No testcase selected for this device; skipping.", "info");
        return;
      }

      // 1. Run Preconditions if not skipped
      if (!skipPreconditions.checked) {
        appendLog(id, "Cleaning previous APK installation state...", "info");
        try {
          await invoke("cleanup_apks", { deviceId: id });
        } catch(err) {
          appendLog(id, "Cleanup before preconditions failed: " + err, "error");
        }

        appendLog(id, "Running Preconditions (Install & Setup)...", "info");
        try {
          await invoke("run_install_sequence", { deviceId: id, plan: planStr });
        } catch(err) {
          appendLog(id, "Preconditions failed: " + err, "error");
          // we might want to continue or stop? usually we continue or fail device. Let's continue.
        }
      }

      // 2. Run selected tests
      let allTestsPassed = true;
      for (const testClass of selectedTests) {
         updateChecklistResult(id, testClass, "RUNNING");
         // Find row in table for this test
         const startTime = Date.now();
         try {
           const resultStatus = await invoke("run_instrumentation_test", {
             deviceId: id,
             testClass: testClass
           });
           if (resultStatus !== "Pass") allTestsPassed = false;
           updateChecklistResult(id, testClass, resultStatus ? resultStatus.toUpperCase() : "DONE");
         } catch(err) {
           allTestsPassed = false;
           appendLog(id, `Test Failed: ${err}`, "error");
           updateChecklistResult(id, testClass, "ERROR");
         } finally {
           const duration = ((Date.now() - startTime) / 1000).toFixed(1);
           updateChecklistTime(id, testClass, `${duration}s`);
         }
      }

      if (allTestsPassed) {
        appendLog(id, "Flow passed. Cleaning up installed APKs...", "success");
        try {
          await invoke("cleanup_apks", { deviceId: id });
        } catch(err) {
          appendLog(id, "Cleanup after passed flow failed: " + err, "error");
        }
      } else {
        appendLog(id, "Flow did not fully pass; keeping APKs installed for debugging.", "info");
      }

      appendLog(id, "Pulling test results automatically...", "info");
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
    } finally {
      updateSummary();
      setLoadingState(false);
      isRunInProgress = false;
    }
  }



  listen("install-log", (event) => {
    const { device_id, message, status, progress } = event.payload;
    const fill = document.getElementById(`progress-${device_id}`);
    if (fill) {
      fill.style.width = `${progress}%`;
      if (status === "error") fill.style.background = "rgba(255, 77, 77, 0.1)";
      else fill.style.background = "rgba(61, 220, 132, 0.15)";
    }
    syncChecklistStateFromLog(device_id, message);
    appendLog(device_id, message, status);
  });

  function setupSidebarResize() {
    if (!sidebarLogs || !sidebarLogsResizer) return;

    let resizing = false;
    let activePointerId = null;
    const minWidth = 360;

    sidebarLogsResizer.addEventListener("pointerdown", (event) => {
      resizing = true;
      activePointerId = event.pointerId;
      sidebarLogsResizer.setPointerCapture(event.pointerId);
      sidebarLogsResizer.classList.add("resizing");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    });

    window.addEventListener("pointermove", (event) => {
      if (!resizing) return;
      const maxWidth = Math.floor(window.innerWidth * 0.6);
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - event.clientX));
      document.documentElement.style.setProperty("--sidebar-logs-width", `${nextWidth}px`);
    });

    const stopResize = () => {
      if (!resizing) return;
      resizing = false;
      if (activePointerId !== null) {
        try {
          sidebarLogsResizer.releasePointerCapture(activePointerId);
        } catch (_) {}
      }
      activePointerId = null;
      sidebarLogsResizer.classList.remove("resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function updateChecklistResult(deviceId, testcase, result) {
    const test = checklistState.get(deviceId)?.get(testcase);
    if (!test) return;
    test.result = result;
    const row = findChecklistRow(deviceId, testcase);
    const resultCell = row?.querySelector(".tc-result");
    if (resultCell) {
      resultCell.textContent = result;
      applyResultStyle(resultCell, result);
    }
    updateSummary();
  }

  function updateChecklistTime(deviceId, testcase, value) {
    const test = checklistState.get(deviceId)?.get(testcase);
    if (!test) return;
    test.time = value;
    const row = findChecklistRow(deviceId, testcase);
    const timeCell = row?.querySelector(".tc-time");
    if (timeCell) timeCell.textContent = value;
    updateSummary();
  }

  function syncChecklistStateFromLog(deviceId, message) {
    const testcaseMatch = message.match(/^Running testcase:\s+(.+)$/);
    if (!testcaseMatch) return;

    const rawStatus = testcaseMatch[1];
    const [baseTestcase, suffix] = rawStatus.split(/_(?=[^_]+$)/);
    if (!baseTestcase || !suffix) return;

    const normalizedSuffix = suffix.toUpperCase();
    if (normalizedSuffix === "EXECUTING") {
      updateChecklistResult(deviceId, baseTestcase, "EXECUTING");
      return;
    }
    if (normalizedSuffix === "PASS") {
      updateChecklistResult(deviceId, baseTestcase, "PASS");
      return;
    }
    if (normalizedSuffix === "FAIL") {
      updateChecklistResult(deviceId, baseTestcase, "FAIL");
    }
  }

  runRealTestBtn.addEventListener("click", startRealInstrumentation);
  stopBtn.addEventListener("click", () => {
    invoke("emergency_stop");
    appendLog("SYSTEM", "Emergency Stop Requested!", "error");
  });
  refreshBtn.addEventListener("click", () => refreshDevices(true));

  setupSidebarResize();
  refreshDevices(false);
});
