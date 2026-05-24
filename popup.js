let detectedUsername = null;

// Check if active tab is on Instagram and enable controls
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const currentTab = tabs[0];
  const targetProfileDiv = document.getElementById("targetProfile");
  const imageInput = document.getElementById("imageInput");
  const syncBtn = document.getElementById("syncBtn");

  if (currentTab && currentTab.url && currentTab.url.includes("instagram.com")) {
    if (imageInput) imageInput.disabled = false;
    if (syncBtn) syncBtn.disabled = false;

    try {
      const urlObj = new URL(currentTab.url);
      const pathSegments = urlObj.pathname.split("/").filter(Boolean);
      if (pathSegments.length > 0 && !["explore", "p", "reels", "stories"].includes(pathSegments[0])) {
        detectedUsername = pathSegments[0];
        targetProfileDiv.innerText = `@${detectedUsername}`;
      } else {
        targetProfileDiv.innerText = "Instagram Page Detected";
      }
    } catch (e) {
      targetProfileDiv.innerText = "Ready to Scan";
    }
  } else {
    targetProfileDiv.style.color = "#ed4956";
    targetProfileDiv.innerText = "Please navigate to an Instagram Profile";
  }
});

// NEW: Listen for folder selection, process image matrices, and store data
document.getElementById("imageInput").addEventListener("change", async (event) => {
  const statusDiv = document.getElementById("status");
  if (!detectedUsername) {
    statusDiv.style.color = "#ed4956";
    statusDiv.innerText = "Error: Navigate to a user profile first.";
    return;
  }

  const files = Array.from(event.target.files).filter(file => file.type.startsWith("image/"));
  if (files.length === 0) return;

  statusDiv.style.color = "#8e8e8e";
  statusDiv.innerText = `Processing ${files.length} images...`;

  const processedProfiles = [];

  for (const file of files) {
    try {
      const colorProfile = await generateColorProfileFromFile(file);
      processedProfiles.push(colorProfile);
    } catch (err) {
      console.error("Failed to parse local file: ", file.name, err);
    }
  }

  const storageKey = `insta_profile_${detectedUsername}`;
  chrome.storage.local.set({ [storageKey]: processedProfiles }, () => {
    statusDiv.style.color = "#0095f6";
    statusDiv.innerText = `Folder loaded! Saved ${processedProfiles.length} image signatures.`;
  });
});

// Helper to convert an uploaded local file object to a 10x10 data array
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
          const imgData = ctx.getImageData(0, 0, 10, 10).data;
          resolve(Array.from(imgData));
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

        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "scan_instagram" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.debug("Port closed naturally. Relying on decoupled storage listeners.");
            }
          },
        );
      });
    },
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.scan_state?.newValue) {
    const state = changes.scan_state.newValue;
    const statusDiv = document.getElementById("status");
    const progBar = document.getElementById("progressBar");
    const progText = document.getElementById("progressText");

    if (!statusDiv) return;

    if (state.status === "progress") {
      statusDiv.style.color = "#8e8e8e";
      statusDiv.innerText = state.log || "Scanning...";
      if (progBar && progText) {
        const percentage = state.total > 0 ? (state.current / state.total) * 100 : 0;
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