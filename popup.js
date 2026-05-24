let currentUsername = "";

// 1. Detect the Instagram username immediately when popup opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const currentTab = tabs[0];
  if (currentTab && currentTab.url.includes("instagram.com")) {
    try {
      const urlPath = new URL(currentTab.url).pathname;
      const pathSegments = urlPath.split('/').filter(segment => segment.length > 0);
      const ignoredPaths = ['explore', 'p', 'stories', 'reels', 'direct', 'developer'];
      
      if (pathSegments.length > 0 && !ignoredPaths.includes(pathSegments[0])) {
        currentUsername = pathSegments[0];
        document.getElementById('targetProfile').innerText = `@${currentUsername}`;
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }
  document.getElementById('targetProfile').innerText = "Not on a valid profile page";
  document.getElementById('imageInput').disabled = true;
  document.getElementById('syncBtn').disabled = true;
});

// 2. Process and extract stable color profiles from files
document.getElementById('imageInput').addEventListener('change', async (event) => {
  const files = event.target.files;
  const imageProfiles = [];
  const statusDiv = document.getElementById('status');

  if (!currentUsername || files.length === 0) return;
  statusDiv.innerText = "Generating robust image profiles...";

  for (let file of files) {
    if (file.type.startsWith('image/')) {
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

// BUG FIX: Instead of text string matching, read color averages across parts of the image
function generateColorProfile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 10; // 10x10 grid is enough for signature detection
        canvas.height = 10;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 10, 10);
          const imgData = ctx.getImageData(0, 0, 10, 10).data;
          
          // Store raw numerical color sequence
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

// 3. Signal content script to execute match scanning
document.getElementById('syncBtn').addEventListener('click', () => {
  const statusDiv = document.getElementById('status');
  statusDiv.innerText = "Scanning layout & matching images...";

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].id) {
      statusDiv.innerText = "Error: No active tab found.";
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: "scan_instagram" }, (response) => {
      if (chrome.runtime.lastError) {
        statusDiv.innerText = "Please refresh the Instagram page and try again.";
      } else if (response && response.status === "complete") {
        statusDiv.innerText = `Scan complete! Marked ${response.matchesFound} matched posts.`;
      }
    });
  });
});