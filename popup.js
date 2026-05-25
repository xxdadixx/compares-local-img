// popup.js
let detectedUsername = null;
let currentTabId = null;

const urlParams = new URLSearchParams(window.location.search);
const isDetachedPanel = urlParams.get("detached") === "true";
const queryTabId = urlParams.get("targetTabId");

if (isDetachedPanel) {
  // FIX: Removed padding modification to ensure exact 16px layout sizing symmetry
  const detachLink = document.getElementById("detachWinBtn");
  if (detachLink) detachLink.style.display = "none";
}

document.getElementById("detachWinBtn").addEventListener("click", () => {
  if (!currentTabId) return;
  chrome.windows.create({
    url: chrome.runtime.getURL(
      `popup.html?detached=true&targetTabId=${currentTabId}`,
    ),
    type: "popup",
    width: 308, // FIX: Sized precisely to account for 292px content body + OS window borders
    height: 350, // FIX: Accommodates layout card without squeezing elements or cutting content
    focused: true,
  });
  window.close();
});

// FIX: Consolidated Unified UI Rendering Engine to eliminate state tracking discrepancies
function updateProgressUI(state) {
  const statusDiv = document.getElementById("status");
  const progContainer = document.getElementById("progressContainer");
  const progBar = document.getElementById("progressBar");
  const progText = document.getElementById("progressText");
  const syncBtn = document.getElementById("syncBtn");

  if (!state || state.status === "idle") return;

  if (state.status === "starting") {
    statusDiv.style.color = "#8e8e8e";
    statusDiv.innerText = "Initializing scan pipeline...";
    if (progContainer) progContainer.style.display = "block";
    if (progBar) progBar.style.width = "0%";
    if (progText) {
      progText.style.display = "block";
      progText.innerText = "Connecting...";
    }
    if (syncBtn) syncBtn.disabled = true;
  } else if (state.status === "progress") {
    statusDiv.style.color = "#8e8e8e";
    statusDiv.innerText = state.log || "Scanning...";
    if (progContainer) progContainer.style.display = "block";

    if (progBar && progText) {
      progText.style.display = "block";
      let current = 0;
      let total = 0;

      // Map properties dynamically depending on the tracking phase from content.js
      if (state.phase === "fetching") {
        current = state.fetchCurrent || 0;
        total = state.fetchTotal || 0;
      } else if (state.phase === "comparing") {
        current = state.compareCurrent || 0;
        total = state.compareTotal || 0;
      }

      const percentage = total > 0 ? (current / total) * 100 : 0;
      progBar.style.width = `${percentage}%`;
      progText.innerText = `${current} / ${total}`;
    }
    if (syncBtn) syncBtn.disabled = true;
  } else if (state.status === "complete") {
    statusDiv.style.color = "#0095f6";
    statusDiv.innerText = `Scan complete! Marked ${state.matchesFound} matched posts.`;
    if (progContainer) progContainer.style.display = "block";
    if (progBar) progBar.style.width = "100%";
    if (progText) {
      progText.style.display = "block";
      progText.innerText = "Finished";
    }
    if (syncBtn) syncBtn.disabled = false;
  } else if (state.status === "error") {
    statusDiv.style.color = "#ed4956";
    statusDiv.innerText = `Error: ${state.message}`;
    if (progBar) progBar.style.width = "0%";
    if (progText) {
      progText.style.display = "block";
      progText.innerText = "Failed";
    }
    if (syncBtn) syncBtn.disabled = false;
  }
}

function restoreScanState() {
  if (!currentTabId) return;

  const statusDiv = document.getElementById("status");
  const progContainer = document.getElementById("progressContainer");
  const progBar = document.getElementById("progressBar");
  const progText = document.getElementById("progressText");
  const syncBtn = document.getElementById("syncBtn");

  const activeKey = `is_scanning_active_${currentTabId}`;
  const stateKey = `scan_state_${currentTabId}`;

  chrome.storage.local.get([activeKey, stateKey], (data) => {
    const isScanningActive = data[activeKey];
    const state = data[stateKey];

    if (!state || state.status === "idle") {
      // FIX: Only enable scan button if signatures are explicitly present in storage
      if (detectedUsername) {
        const storageKey = `insta_profile_${detectedUsername}`;
        chrome.storage.local.get([storageKey], (res) => {
          const profiles = res[storageKey] || [];
          if (syncBtn) syncBtn.disabled = profiles.length === 0;
        });
      } else {
        if (syncBtn) syncBtn.disabled = true;
      }
      return;
    }

    if (isScanningActive && state.status === "starting") {
      statusDiv.style.color = "#8e8e8e";
      statusDiv.innerText = "Initializing scan pipeline...";
      if (progContainer) progContainer.style.display = "block";
      if (progBar) progBar.style.width = "0%";
      if (progText) progText.innerText = "Connecting...";
      if (syncBtn) syncBtn.disabled = true;
    } else if (state.status === "progress") {
      statusDiv.style.color = "#8e8e8e";
      statusDiv.innerText = state.log || "Scanning...";
      if (progContainer) progContainer.style.display = "block";
      if (progBar && progText) {
        const percentage =
          state.total > 0 ? (state.current / state.total) * 100 : 0;
        progBar.style.width = `${percentage}%`;
        progText.innerText = `${state.current} / ${state.total}`;
      }
      if (syncBtn) syncBtn.disabled = true;
    } else if (state.status === "complete") {
      statusDiv.style.color = "#0095f6";
      statusDiv.innerText = `Scan complete! Marked ${state.matchesFound} matched posts.`;
      if (progContainer) progContainer.style.display = "block";
      if (progBar) progBar.style.width = "100%";
      if (progText) {
        progText.style.display = "block";
        progText.innerText = "Finished";
      }
      // FIX: Validate signature existence on complete status
      if (detectedUsername) {
        const storageKey = `insta_profile_${detectedUsername}`;
        chrome.storage.local.get([storageKey], (res) => {
          const profiles = res[storageKey] || [];
          if (syncBtn) syncBtn.disabled = profiles.length === 0;
        });
      } else {
        if (syncBtn) syncBtn.disabled = false;
      }
    } else if (state.status === "error") {
      statusDiv.style.color = "#ed4956";
      statusDiv.innerText = `Error: ${state.message}`;
      // FIX: Validate signature existence on error status
      if (detectedUsername) {
        const storageKey = `insta_profile_${detectedUsername}`;
        chrome.storage.local.get([storageKey], (res) => {
          const profiles = res[storageKey] || [];
          if (syncBtn) syncBtn.disabled = profiles.length === 0;
        });
      } else {
        if (syncBtn) syncBtn.disabled = false;
      }
    }
  });
}

function processTabDetails(targetTab) {
  const targetProfileDiv = document.getElementById("targetProfile");
  const imageInput = document.getElementById("imageInput");
  const syncBtn = document.getElementById("syncBtn");

  if (targetTab && targetTab.url && targetTab.url.includes("instagram.com")) {
    currentTabId = targetTab.id;
    if (imageInput) imageInput.disabled = false;

    try {
      const urlObj = new URL(targetTab.url);
      const pathSegments = urlObj.pathname.split("/").filter(Boolean);
      if (
        pathSegments.length > 0 &&
        !["explore", "p", "reels", "stories"].includes(pathSegments[0])
      ) {
        detectedUsername = pathSegments[0];
        targetProfileDiv.innerText = `@${detectedUsername}`;
      } else {
        detectedUsername = null;
        targetProfileDiv.innerText = "Instagram Page Detected";
      }
    } catch (e) {
      detectedUsername = null;
      targetProfileDiv.innerText = "Ready to Scan";
    }
    // Let restoreScanState verify state and local storage before enabling syncBtn
    restoreScanState();
  } else {
    detectedUsername = null;
    if (imageInput) imageInput.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    targetProfileDiv.style.color = "#ed4956";
    targetProfileDiv.innerText = "Please navigate to an Instagram Profile";
  }
}

// Environment Tab Extraction Routing Execution Path
if (isDetachedPanel && queryTabId) {
  chrome.tabs.get(parseInt(queryTabId, 10), (tab) => {
    if (chrome.runtime.lastError || !tab) {
      document.getElementById("targetProfile").innerText =
        "Linked context lost.";
    } else {
      processTabDetails(tab);
    }
  });
} else {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    processTabDetails(tabs[0]);
  });
}

document
  .getElementById("imageInput")
  .addEventListener("change", async (event) => {
    const statusDiv = document.getElementById("status");
    const progContainer = document.getElementById("progressContainer");
    const progBar = document.getElementById("progressBar");
    const progText = document.getElementById("progressText");
    const syncBtn = document.getElementById("syncBtn");
    const inputEl = event.target;

    if (!detectedUsername) {
      statusDiv.style.color = "#ff3b30";
      statusDiv.innerText = "Error: Navigate to a user profile first.";
      return;
    }

    const files = Array.from(inputEl.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    // Lock input states mid-load loop iteration
    if (syncBtn) syncBtn.disabled = true;
    inputEl.disabled = true;

    statusDiv.style.color = "#86868b";
    statusDiv.innerText = `Synchronizing assets...`;

    if (progContainer) progContainer.style.display = "block";
    if (progBar) progBar.style.width = "0%";
    if (progText) {
      progText.style.display = "block";
      progText.innerText = `0 of ${files.length} loaded`;
    }

    const processedProfiles = [];
    let currentFileIndex = 0;

    for (const file of files) {
      try {
        const colorProfile = await generateColorProfileFromFile(file);
        processedProfiles.push(colorProfile);
      } catch (err) {
        console.error("Failed to parse local file: ", file.name, err);
      }

      currentFileIndex++;
      if (progBar) {
        const percentage = (currentFileIndex / files.length) * 100;
        progBar.style.width = `${percentage}%`;
      }
      if (progText) {
        progText.innerText = `${currentFileIndex} of ${files.length} items parsed`;
      }
    }

    const storageKey = `insta_profile_${detectedUsername}`;
    chrome.storage.local.set({ [storageKey]: processedProfiles }, () => {
      statusDiv.style.color = "#34c759";
      statusDiv.innerText = `Folder loaded! Saved ${processedProfiles.length} image signatures.`;

      if (syncBtn) syncBtn.disabled = false;
      inputEl.disabled = false;

      setTimeout(() => {
        if (progContainer) progContainer.style.display = "none";
        if (progText) progText.style.display = "none";
      }, 1800);
    });
  });

function generateColorProfileFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 10;
        canvas.height = 10;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 10, 10);
          resolve(Array.from(ctx.getImageData(0, 0, 10, 10).data));
        } else {
          reject(new Error("Canvas context failed."));
        }
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

document.getElementById("syncBtn").addEventListener("click", () => {
  const statusDiv = document.getElementById("status");
  const progContainer = document.getElementById("progressContainer");
  const progBar = document.getElementById("progressBar");
  const progText = document.getElementById("progressText");
  const syncBtn = document.getElementById("syncBtn");

  statusDiv.style.color = "#8e8e8e";
  statusDiv.innerText = "Initializing scan pipeline...";

  if (progContainer) progContainer.style.display = "block";
  if (progBar) progBar.style.width = "0%";
  if (progText) progText.innerText = "Connecting...";
  if (syncBtn) syncBtn.disabled = true;

  if (!currentTabId) return;

  const activeKey = `is_scanning_active_${currentTabId}`;
  const stateKey = `scan_state_${currentTabId}`;

  chrome.storage.local.set(
    { [activeKey]: true, [stateKey]: { status: "starting" } },
    () => {
      chrome.tabs.sendMessage(
        currentTabId,
        { action: "scan_instagram", tabId: currentTabId },
        () => {
          if (chrome.runtime.lastError) {
            console.debug(
              "Port closed naturally. Relying on decoupled storage listeners.",
            );
          }
        },
      );
    },
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!currentTabId || areaName !== "local") return;
  const targetStateKey = `scan_state_${currentTabId}`;

  if (changes[targetStateKey]?.newValue) {
    const state = changes[targetStateKey].newValue;
    const statusDiv = document.getElementById("status");
    const progContainer = document.getElementById("progressContainer");
    const progBar = document.getElementById("progressBar");
    const progText = document.getElementById("progressText");
    const syncBtn = document.getElementById("syncBtn");

    if (!statusDiv) return;

    if (state.status === "progress") {
      statusDiv.style.color = "#8e8e8e";
      statusDiv.innerText = state.log || "Scanning...";
      if (progContainer) progContainer.style.display = "block";
      if (progBar && progText) {
        const percentage =
          state.total > 0 ? (state.current / state.total) * 100 : 0;
        progBar.style.width = `${percentage}%`;
        progText.innerText = `${state.current} / ${state.total}`;
      }
      if (syncBtn) syncBtn.disabled = true;
    } else if (state.status === "complete") {
      statusDiv.style.color = "#0095f6";
      statusDiv.innerText = `Scan complete! Marked ${state.matchesFound} matched posts.`;
      if (progBar) progBar.style.width = "100%";
      if (progText) {
        progText.style.display = "block";
        progText.innerText = "Finished";
      }
      // FIX: Check storage profiles on runtime changes
      if (detectedUsername) {
        const storageKey = `insta_profile_${detectedUsername}`;
        chrome.storage.local.get([storageKey], (res) => {
          const profiles = res[storageKey] || [];
          if (syncBtn) syncBtn.disabled = profiles.length === 0;
        });
      } else {
        if (syncBtn) syncBtn.disabled = false;
      }
    } else if (state.status === "error") {
      statusDiv.style.color = "#ed4956";
      statusDiv.innerText = `Error: ${state.message}`;
      if (progBar) progBar.style.width = "0%";
      if (progText) {
        progText.style.display = "block";
        progText.innerText = "Failed";
      }
      // FIX: Check storage profiles on runtime changes
      if (detectedUsername) {
        const storageKey = `insta_profile_${detectedUsername}`;
        chrome.storage.local.get([storageKey], (res) => {
          const profiles = res[storageKey] || [];
          if (syncBtn) syncBtn.disabled = profiles.length === 0;
        });
      } else {
        if (syncBtn) syncBtn.disabled = false;
      }
    }
  }
});
