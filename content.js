chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!chrome.runtime?.id) return;
  
    if (request.action === "scan_instagram") {
      sendResponse({ status: "acknowledged" });
  
      matchImages().catch((error) => {
        if (chrome.runtime?.id) {
          chrome.storage.local.set({
            scan_state: {
              status: "error",
              message: error.message || "Scan failed unexpectedly.",
            },
            is_scanning_active: false,
          });
        }
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
      applyCachedOverlays();
    }, 400);
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  function getPageUsername() {
    const profileHeaderTitle = document.querySelector('header h2, header h1, h2[class*="Username"]');
    if (profileHeaderTitle && profileHeaderTitle.textContent) {
      const cleanName = profileHeaderTitle.textContent.trim().split(" ")[0];
      if (cleanName && cleanName.length > 0) return cleanName;
    }
  
    const pathSegments = window.location.pathname.split("/").filter((segment) => segment.length > 0);
    const ignoredPaths = ["explore", "p", "stories", "reels", "reel", "direct", "developer", "emails"];
    if (pathSegments.length > 0 && !ignoredPaths.includes(pathSegments[0])) {
      return pathSegments[0];
    }
  
    return null;
  }
  
  let matchedUrlsCache = new Set();
  let unmatchedUrlsCache = new Set();
  let totalMatchesFoundCounter = 0;
  
  // NEW: Combines embedded JSON data extraction and short polling to find posts immediately
  async function extractPostsImmediately() {
    const postsMap = new Map();
  
    // Strategy A: Parse Instagram's embedded initialization JSON metadata blocks
    const jsonScripts = document.querySelectorAll('script[type="application/json"]');
    jsonScripts.forEach(script => {
      try {
        const content = script.textContent;
        if (content && (content.includes("display_url") || content.includes("shortcode"))) {
          // Regex sweep to extract post definitions directly from the layout state cache
          const shortcodeMatches = [...content.matchAll(/"shortcode"\s*:\s*"([^"]+)"/g)];
          const urlMatches = [...content.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)];
          
          const limit = Math.min(shortcodeMatches.length, urlMatches.length);
          for (let i = 0; i < limit; i++) {
            const shortcode = shortcodeMatches[i][1];
            let displayUrl = urlMatches[i][1].replace(/\\u0026/g, '&'); // Sanitize unicode ampersands
            if (shortcode && displayUrl && !displayUrl.startsWith("blob:")) {
              postsMap.set(shortcode, { shortcode, display_url: displayUrl });
            }
          }
        }
      } catch (e) {
        console.debug("JSON script parse skipped.");
      }
    });
  
    // Strategy B: Async polling loop to capture DOM elements as they mount
    for (let attempt = 0; attempt < 6; attempt++) {
      const elements = document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]');
      elements.forEach((el) => {
        const img = el.querySelector("img");
        const href = el.getAttribute("href") || "";
        const shortcode = href.split("/").filter(Boolean)[1];
        if (img && img.src && shortcode && !img.src.startsWith("blob:")) {
          postsMap.set(shortcode, { shortcode: shortcode, display_url: img.src });
        }
      });
  
      // If items were captured, break early to save execution time
      if (postsMap.size > 0) break;
      // Otherwise, wait 250ms for layout synchronization
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  
    return Array.from(postsMap.values());
  }
  
  async function matchImages() {
    if (!chrome.runtime?.id) return;
  
    const currentUsername = getPageUsername();
    if (!currentUsername) {
      chrome.storage.local.set({
        scan_state: { status: "error", message: "Not on a valid user profile page." },
        is_scanning_active: false,
      });
      return;
    }
  
    matchedUrlsCache.clear();
    unmatchedUrlsCache.clear();
    totalMatchesFoundCounter = 0;
    document.querySelectorAll(".processed-by-ext").forEach((el) => el.classList.remove("processed-by-ext"));
    document.querySelectorAll(".insta-match-badge").forEach((badge) => badge.remove());
  
    try {
      const storageKey = `insta_profile_${currentUsername}`;
      const data = await new Promise((res) => chrome.storage.local.get([storageKey], res));
      const localProfiles = data[storageKey] || [];
  
      if (localProfiles.length === 0) {
        chrome.storage.local.set({
          scan_state: { status: "error", message: "No local image folder loaded for this user yet." },
          is_scanning_active: false,
        });
        return;
      }
  
      // Call immediate finder logic to fetch all data instantly
      const profilePosts = await extractPostsImmediately();
  
      if (profilePosts.length === 0) {
        chrome.storage.local.set({
          scan_state: { status: "error", message: "No structural posts visible. Try reloading the profile." },
          is_scanning_active: false,
        });
        return;
      }
  
      let processedCount = 0;
      for (const post of profilePosts) {
        processedCount++;
        if (!chrome.runtime?.id) break;
  
        chrome.storage.local.set({
          scan_state: {
            status: "progress",
            current: processedCount,
            total: profilePosts.length,
            log: `Analyzing post metadata ${processedCount} of ${profilePosts.length}...`
          }
        });
  
        try {
          const instaProfile = await convertUrlToColorProfile(post.display_url);
          const matchFound = localProfiles.some((localProfile) => isProfileSimilar(localProfile, instaProfile));
  
          if (matchFound) {
            matchedUrlsCache.add(post.shortcode);
            totalMatchesFoundCounter++;
          } else {
            unmatchedUrlsCache.add(post.shortcode);
          }
        } catch (e) {
          console.debug("Skip individual image signature conversion.");
        }
      }
  
      applyCachedOverlays();
  
      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          scan_state: { status: "complete", matchesFound: totalMatchesFoundCounter },
          is_scanning_active: false,
        });
      }
    } catch (err) {
      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          scan_state: { status: "error", message: "An unexpected layout evaluation error occurred." },
          is_scanning_active: false,
        });
      }
    }
  }
  
  function applyCachedOverlays() {
    const postContainers = document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]');
    postContainers.forEach((container) => {
      const urlPath = container.getAttribute("href") || "";
      const segments = urlPath.split("/").filter(Boolean);
      const shortcode = segments[1];
      if (!shortcode) return;
  
      if (matchedUrlsCache.has(shortcode)) {
        updateOrCreateOverlay(container, "💾 MATCHED", "#0095f6");
        container.classList.add("processed-by-ext");
      } else if (unmatchedUrlsCache.has(shortcode)) {
        updateOrCreateOverlay(container, "❌ NO MATCH", "rgba(38, 38, 38, 0.7)");
        container.classList.add("processed-by-ext");
      }
    });
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
  
  function updateOrCreateOverlay(containerElement, text, backgroundColor) {
    containerElement.style.position = "relative";
    let overlay = containerElement.querySelector(".insta-match-badge");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "insta-match-badge";
      containerElement.appendChild(overlay);
    }
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
  }