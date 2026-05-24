chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!chrome.runtime?.id) return;
  
    if (request.action === "scan_instagram") {
      matchImages()
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            status: "error",
            message: error.message || "Scan failed unexpectedly.",
          });
        });
  
      return true; 
    }
  });
  
  let scrollDebounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }
  
    clearTimeout(scrollDebounceTimeout);
    scrollDebounceTimeout = setTimeout(() => {
      try {
        chrome.storage.local.get(["is_scanning_active"], (data) => {
          if (chrome.runtime.lastError) {
            observer.disconnect();
          } else if (data && data.is_scanning_active === true) {
            matchImages();
          }
        });
      } catch (e) {
        observer.disconnect();
      }
    }, 300);
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  function getPageUsername() {
    const profileHeaderTitle = document.querySelector(
      'header h2, header h1, h2[class*="Username"]',
    );
    if (profileHeaderTitle && profileHeaderTitle.textContent) {
      const cleanName = profileHeaderTitle.textContent.trim().split(" ")[0];
      if (cleanName && cleanName.length > 0) {
        return cleanName;
      }
    }
  
    const pathSegments = window.location.pathname
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
      return pathSegments[0];
    }
  
    return null;
  }
  
  let lastUsername = "";
  let totalMatchesFoundCounter = 0; 
  
  function getLocalStorageData(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(data);
      });
    });
  }
  
  async function matchImages() {
    if (!chrome.runtime?.id)
      return { status: "error", message: "Extension context invalidated." };
  
    const currentUsername = getPageUsername();
    if (!currentUsername) {
      return { status: "error", message: "Not on a valid user profile page." };
    }
  
    if (currentUsername !== lastUsername) {
      document.querySelectorAll(".processed-by-ext").forEach((el) => el.classList.remove("processed-by-ext"));
      document.querySelectorAll(".insta-match-badge").forEach((badge) => badge.remove());
      lastUsername = currentUsername;
      totalMatchesFoundCounter = 0; 
      chrome.storage.local.set({ is_scanning_active: false }); 
    }
  
    try {
      const storageKey = `insta_profile_${currentUsername}`;
      const data = await getLocalStorageData([storageKey, "is_scanning_active"]);
      
      const localProfiles = data[storageKey] || [];
      if (localProfiles.length === 0) {
        return {
          status: "error",
          message: "No local image profile folder has been loaded for this user yet.",
        };
      }
  
      const postContainers = document.querySelectorAll(
        'article a[href^="/p/"], article a[href^="/reel/"], div[style*="padding-bottom"]'
      );
      const totalContainers = postContainers.length;
  
      if (totalContainers === 0) {
        return {
          status: "error",
          message: "No posts found on page layout. Try scrolling down or refreshing.",
        };
      }
  
      let itemsProcessedCount = 0;
      let validImagesScanned = 0;
  
      for (const container of postContainers) {
        itemsProcessedCount++;
  
        chrome.runtime
          .sendMessage({
            action: "scan_progress",
            current: itemsProcessedCount,
            total: totalContainers,
            log: `Scanning profile layout: grid item ${itemsProcessedCount} of ${totalContainers}...`,
          })
          .catch(() => { /* Popup closed */ });
  
        if (container.classList.contains("processed-by-ext")) {
          validImagesScanned++;
          continue;
        }
  
        let imgElement = container.querySelector("img");
        if (!imgElement) {
          imgElement = container.parentNode ? container.parentNode.querySelector("img") : null;
        }
  
        if (!imgElement || !imgElement.src || imgElement.src.startsWith("blob:")) {
          updateOrCreateOverlay(container, "⏳ LOADING SOURCE...", "rgba(219, 74, 57, 0.85)");
          continue;
        }
  
        container.classList.add("processed-by-ext");
        validImagesScanned++;
  
        const badge = updateOrCreateOverlay(container, "⏳ CHECKING...", "rgba(0, 0, 0, 0.75)");
  
        try {
          const instaProfile = await convertUrlToColorProfile(imgElement.src);
          const matchFound = localProfiles.some((localProfile) => isProfileSimilar(localProfile, instaProfile));
  
          if (matchFound) {
            updateOrCreateOverlay(container, "💾 MATCHED", "#0095f6", badge);
            totalMatchesFoundCounter++; 
          } else {
            updateOrCreateOverlay(container, "❌ NO MATCH", "rgba(38, 38, 38, 0.7)", badge);
          }
        } catch (e) {
          updateOrCreateOverlay(container, "⚠️ CORS BLOCKED", "#ed4956", badge);
          container.classList.remove("processed-by-ext");
          console.debug("Failed to process target image array canvas data.");
        }
      }
  
      if (data.is_scanning_active === true) {
        window.scrollTo(0, document.body.scrollHeight);
        
        // Extended timeout slightly to 1500ms to allow DOM attachments to register cleanly
        await new Promise((r) => setTimeout(r, 1500));
        
        const newPostContainers = document.querySelectorAll(
          'article a[href^="/p/"], article a[href^="/reel/"], div[style*="padding-bottom"]'
        );
        
        if (newPostContainers.length > totalContainers) {
          return await matchImages(); 
        }
      }
  
      // CRITICAL BUG FIX: Force clean termination by explicitly turning off the background state flag 
      // when the end of the profile grid is reached. This stops the MutationObserver from firing again.
      chrome.storage.local.set({ is_scanning_active: false });
  
      if (validImagesScanned === 0) {
        return {
          status: "error",
          message: "Images are currently lazy-loading. Scroll down slightly on the page and try again.",
        };
      }
  
      return {
        status: "complete",
        matchesFound: totalMatchesFoundCounter,
      };
  
    } catch (err) {
      return {
        status: "error",
        message: "An unexpected layout runtime error occurred.",
      };
    }
  }
  
  function convertUrlToColorProfile(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = url;
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
          reject(new Error("Canvas generation failure."));
        }
      };
      img.onerror = (err) => reject(err);
    });
  }
  
  function isProfileSimilar(profile1, profile2) {
    if (profile1.length !== profile2.length) return false;
    let totalDifference = 0;
    for (let i = 0; i < profile1.length; i++) {
      if ((i + 1) % 4 === 0) continue;
      totalDifference += Math.abs(profile1[i] - profile2[i]);
    }
    const averageChannelDifference = totalDifference / (profile1.length * 0.75);
    return averageChannelDifference < 12;
  }
  
  function updateOrCreateOverlay(
    containerElement,
    text,
    backgroundColor,
    existingBadge = null,
  ) {
    containerElement.style.position = "relative";
  
    const overlay =
      existingBadge ||
      containerElement.querySelector(".insta-match-badge") ||
      document.createElement("div");
  
    overlay.className = "insta-match-badge";
    overlay.innerText = text;
    overlay.style.position = "absolute";
    overlay.style.bottom = "12px";
    overlay.style.right = "12px";
    overlay.style.backgroundColor = backgroundColor;
    overlay.style.color = "white";
    overlay.style.padding = "5px 10px";
    overlay.style.borderRadius = "4px";
    overlay.style.fontSize = "12px";
    overlay.style.fontWeight = "bold";
    overlay.style.zIndex = "999";
    overlay.style.pointerEvents = "none";
    overlay.style.transition = "all 0.2s ease";
  
    if (!existingBadge && !containerElement.querySelector(".insta-match-badge")) {
      containerElement.appendChild(overlay);
    }
  
    return overlay;
  }