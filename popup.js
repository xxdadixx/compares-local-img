let currentUsername = "";

// 1. Detect the Instagram username immediately when popup opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const currentTab = tabs[0];

  // Strict execution gate: Verify tab object exists and explicitly contains instagram.com
  if (
    currentTab &&
    currentTab.url &&
    currentTab.url.includes("instagram.com")
  ) {
    try {
      const urlPath = new URL(currentTab.url).pathname;
      const pathSegments = urlPath
        .split("/")
        .filter((segment) => segment.length > 0);
      const ignoredPaths = [
        "explore",
        "p",
        "stories",
        "reels",
        "reel",
        "direct",
        "developer",
        "emails",
      ];

      if (pathSegments.length > 0 && !ignoredPaths.includes(pathSegments[0])) {
        currentUsername = pathSegments[0];
        document.getElementById("targetProfile").innerText =
          `@${currentUsername}`;

        // UNLOCK ONLY IF VALIDATED: Enable controls exclusively on genuine Instagram profiles
        document.getElementById("imageInput").disabled = false;
        document.getElementById("syncBtn").disabled = false;
        return;
      }
    } catch (e) {
      console.error("URL parsing exception: ", e);
    }
  }

  // Fallback UI State for unauthorized sites or pages
  document.getElementById("targetProfile").innerText =
    "Not on a valid profile page";
  document.getElementById("targetProfile").style.color = "#ed4956";
  document.getElementById("imageInput").disabled = true;
  document.getElementById("syncBtn").disabled = true;
});

// 2. Process and extract stable color profiles from files
document
  .getElementById("imageInput")
  .addEventListener("change", async (event) => {
    const files = event.target.files;
    const imageProfiles = [];
    const statusDiv = document.getElementById("status");

    // Security Gate: Terminate execution immediately if username isn't resolved
    if (!currentUsername || files.length === 0) return;
    statusDiv.innerText = "Generating robust image profiles...";

    for (let file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const colorProfile = await generateColorProfile(file);
          imageProfiles.push(colorProfile);
        } catch (e) {
          console.error("Error analyzing file:", file.name, e);
        }
      }
    }

    const storageKey = `insta_profile_${currentUsername}`;
    chrome.storage.local.set({ [storageKey]: imageProfiles }, () => {
      if (chrome.runtime.lastError) {
        statusDiv.innerText = "Error: Storage failure!";
        console.error(chrome.runtime.lastError.message);
      } else {
        statusDiv.innerText = `Successfully synced ${imageProfiles.length} image profiles!`;
      }
    });
  });

function generateColorProfile(file) {
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
          const profile = Array.from(imgData);
          resolve(profile);
        } else {
          reject(new Error("Canvas context failure"));
        }
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// Find section "3. Signal content script to execute match scanning" in popup.js and replace it with this:

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

  // Set the scan execution gate to true so content.js knows it is allowed to process overlays
  chrome.storage.local.set({ is_scanning_active: true }, () => {
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
            statusDiv.style.color = "#ed4956";
            statusDiv.innerText =
              "Connection lost. Please refresh the Instagram page and try again.";
            if (progContainer) progContainer.style.display = "none";
            chrome.storage.local.set({ is_scanning_active: false });
          } else if (response && response.status === "error") {
            statusDiv.style.color = "#ed4956";
            statusDiv.innerText = `Error: ${response.message}`;
            if (progBar) progBar.style.width = "0%";
            if (progText) progText.innerText = "Failed";
            chrome.storage.local.set({ is_scanning_active: false });
          } else if (response && response.status === "complete") {
            statusDiv.style.color = "#0095f6";
            statusDiv.innerText = `Scan complete! Marked ${response.matchesFound} matched posts.`;
            if (progBar) progBar.style.width = "100%";
            if (progText) progText.innerText = "Finished";
          }
        },
      );
    });
  });
});

// 4. Handle incoming real-time batch messages from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "scan_progress") {
    const progBar = document.getElementById("progressBar");
    const progText = document.getElementById("progressText");
    const statusDiv = document.getElementById("status");

    if (progBar && progText) {
      const percentage =
        message.total > 0 ? (message.current / message.total) * 100 : 0;
      progBar.style.width = `${percentage}%`;
      progText.innerText = `${message.current} / ${message.total}`;
    }
    if (statusDiv && message.log) {
      statusDiv.innerText = message.log;
    }
  }
});
