document.getElementById("syncBtn").addEventListener("click", () => {
  const statusDiv = document.getElementById("status");
  const progContainer = document.getElementById("progressContainer");
  const progBar = document.getElementById("progressBar");
  const progText = document.getElementById("progressText");

  statusDiv.style.color = "#8e8e8e";
  statusDiv.innerText = "Initializing scan pipeline...";

  if (progContainer) progContainer.style.display = "block";
  if (progBar) progBar.style.width = "0%";
  if (progText) progText.innerText = "Connecting...";

  chrome.storage.local.set(
    { is_scanning_active: true, scan_state: { status: "starting" } },
    () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].id) {
          statusDiv.style.color = "#ed4956";
          statusDiv.innerText = "Error: No active tab found.";
          if (progContainer) progContainer.style.display = "none";
          chrome.storage.local.set({ is_scanning_active: false });
          return;
        }

        // Fire the message trigger to activate scan processing loops
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "scan_instagram" },
          (response) => {
            if (chrome.runtime.lastError) {
              // If the message port disconnected, do nothing. Storage polling handles status tracking safely.
              console.debug(
                "Port closed naturally. Relying on decoupled storage listeners.",
              );
            }
          },
        );
      });
    },
  );
});

// Seamless long-term reactive state synchronization observer
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.scan_state?.newValue) {
    const state = changes.scan_state.newValue;
    const statusDiv = document.getElementById("status");
    const progContainer = document.getElementById("progressContainer");
    const progBar = document.getElementById("progressBar");
    const progText = document.getElementById("progressText");

    if (!statusDiv) return;

    if (state.status === "progress") {
      statusDiv.style.color = "#8e8e8e";
      statusDiv.innerText = state.log || "Scanning...";
      if (progBar && progText) {
        const percentage =
          state.total > 0 ? (state.current / state.total) * 100 : 0;
        progBar.style.width = `${percentage}%`;
        progText.innerText = `${state.current} / ${state.total}`;
      }
    } else if (state.status === "complete") {
      statusDiv.style.color = "#0095f6";
      statusDiv.innerText = `Scan complete! Marked ${state.matchesFound} matched posts.`;
      if (progBar) progBar.style.width = "100%";
      if (progText) progText.innerText = "Finished";
    } else if (state.status === "error") {
      statusDiv.style.color = "#ed4956";
      statusDiv.innerText = `Error: ${state.message}`;
      if (progBar) progBar.style.width = "0%";
      if (progText) progText.innerText = "Failed";
    }
  }
});

// Seamless long-term reactive state synchronization observer
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.scan_state?.newValue) {
    const state = changes.scan_state.newValue;
    const statusDiv = document.getElementById("status");
    const progContainer = document.getElementById("progressContainer");
    const progBar = document.getElementById("progressBar");
    const progText = document.getElementById("progressText");

    if (!statusDiv) return;

    if (state.status === "progress") {
      statusDiv.style.color = "#8e8e8e";
      statusDiv.innerText = state.log || "Scanning...";
      if (progBar && progText) {
        const percentage =
          state.total > 0 ? (state.current / state.total) * 100 : 0;
        progBar.style.width = `${percentage}%`;
        progText.innerText = `${state.current} / ${state.total}`;
      }
    } else if (state.status === "complete") {
      statusDiv.style.color = "#0095f6";
      statusDiv.innerText = `Scan complete! Marked ${state.matchesFound} matched posts.`;
      if (progBar) progBar.style.width = "100%";
      if (progText) progText.innerText = "Finished";
    } else if (state.status === "error") {
      statusDiv.style.color = "#ed4956";
      statusDiv.innerText = `Error: ${state.message}`;
      if (progBar) progBar.style.width = "0%";
      if (progText) progText.innerText = "Failed";
    }
  }
});
