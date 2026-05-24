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
  let processedUrlsCache = new Set(); // Tracks historical unique shortcodes to prevent re-processing
  let totalMatchesFoundCounter = 0;
  
  /**
   * FIXED: High-performance, synchronized loop that extracts, processes, 
   * and applies image badges instantly before the DOM can unmount them.
   */
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
  
    // Reset tracking states cleanly
    matchedUrlsCache.clear();
    unmatchedUrlsCache.clear();
    processedUrlsCache.clear();
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
  
      let lastScrollHeight = 0;
      let noChangeCount = 0;
      const maxScrollAttempts = 35; // Extends structural scanning depth
  
      for (let i = 0; i < maxScrollAttempts; i++) {
        if (!chrome.runtime?.id) break;
  
        // Find all target containers currently available in the active DOM frame
        const visibleElements = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        
        // Process newly rendered items immediately on this viewport frame
        for (const el of visibleElements) {
          const img = el.querySelector("img");
          const href = el.getAttribute("href") || "";
          const segments = href.split("/").filter(Boolean);
          const shortcode = segments[1] === "p" || segments[1] === "reel" ? segments[2] : segments[1];
  
          if (shortcode && img && img.src && !img.src.startsWith("blob:") && !processedUrlsCache.has(shortcode)) {
            processedUrlsCache.add(shortcode);
  
            // Update popup pipeline telemetry details smoothly
            chrome.storage.local.set({
              scan_state: {
                status: "progress",
                current: processedUrlsCache.size,
                total: Math.max(processedUrlsCache.size + 6, 30),
                log: `Analyzing post layout profile matrix: item ${processedUrlsCache.size}...`
              }
            });
  
            try {
              const instaProfile = await convertUrlToColorProfile(img.src);
              const matchFound = localProfiles.some((localProfile) => isProfileSimilar(localProfile, instaProfile));
  
              if (matchFound) {
                matchedUrlsCache.add(shortcode);
                totalMatchesFoundCounter++;
              } else {
                unmatchedUrlsCache.add(shortcode);
              }
            } catch (e) {
              console.debug("Skipped unreadable resource payload.");
            }
          }
        }
  
        // Draw overlays instantly to visible nodes while they remain present in the DOM
        applyCachedOverlays();
  
        // Execute incremental scrolling interaction
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((resolve) => setTimeout(resolve, 1100)); // Optimal window loading stabilization delay
  
        const currentScrollHeight = document.body.scrollHeight;
        if (currentScrollHeight === lastScrollHeight) {
          noChangeCount++;
          if (noChangeCount >= 2) break; // Reached bottom edge boundary safely
        } else {
          noChangeCount = 0;
        }
        lastScrollHeight = currentScrollHeight;
      }
  
      // Return view back safely to page peak
      window.scrollTo({ top: 0, behavior: 'smooth' });
  
      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          scan_state: { status: "complete", matchesFound: totalMatchesFoundCounter },
          is_scanning_active: false,
        });
      }
    } catch (err) {
      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          scan_state: { status: "error", message: "An unexpected evaluation layout boundary error occurred." },
          is_scanning_active: false,
        });
      }
    }
  }
  
  function applyCachedOverlays() {
    const postContainers = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    postContainers.forEach((container) => {
      const urlPath = container.getAttribute("href") || "";
      const segments = urlPath.split("/").filter(Boolean);
      const shortcode = segments[1] === "p" || segments[1] === "reel" ? segments[2] : segments[1];
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