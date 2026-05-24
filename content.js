// content.js

// 1. Script Injection Hook
try {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inject.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
} catch (e) {
  console.debug("Script injection bypassed context constraints.");
}

// 2. Cross-Context Message Relay
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.type === "INSTA_API_INTERCEPTED") {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        action: "process_api_payload",
        url: event.data.url,
        payload: event.data.payload,
      });
    }
  }
});

// 3. Operational State Caches
let matchedUrlsCache = new Set();
let unmatchedUrlsCache = new Set();
let processingUrlsCache = new Set();
let processedUrlsCache = new Set();
let totalMatchesFoundCounter = 0;

// 4. MutationObserver & Debouncer Layout (Safely watches root node)
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

if (document.documentElement) {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
} else {
  window.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// 5. Message listener for extension scans
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

/**
 * FIXED: Restored getPageUsername function mapping
 * Extracts the user profile slug cleanly from headings or browser route patterns.
 */
function getPageUsername() {
  const profileHeaderTitle = document.querySelector(
    'header h2, header h1, h2[class*="Username"]',
  );
  if (profileHeaderTitle && profileHeaderTitle.textContent) {
    const cleanName = profileHeaderTitle.textContent.trim().split(" ")[0];
    if (cleanName && cleanName.length > 0) return cleanName;
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

/**
 * Verifies if a targeted element is inside an active overlay modal viewport.
 * This keeps extension overlays strictly confined to the main grid collection view.
 */
function isInsideModal(element) {
  return !!element.closest('div[role="dialog"], div[role="presentation"]');
}

async function matchImages() {
  if (!chrome.runtime?.id) return;

  const currentUsername = getPageUsername();
  if (!currentUsername) {
    chrome.storage.local.set({
      scan_state: {
        status: "error",
        message: "Not on a valid user profile page.",
      },
      is_scanning_active: false,
    });
    return;
  }

  // Clear operational states cleanly
  matchedUrlsCache.clear();
  unmatchedUrlsCache.clear();
  processedUrlsCache.clear();
  if (typeof processingUrlsCache !== "undefined") processingUrlsCache.clear();
  totalMatchesFoundCounter = 0;

  document
    .querySelectorAll(".processed-by-ext")
    .forEach((el) => el.classList.remove("processed-by-ext"));
  document
    .querySelectorAll(".insta-match-badge")
    .forEach((badge) => badge.remove());

  try {
    const storageKey = `insta_profile_${currentUsername}`;
    const data = await new Promise((res) =>
      chrome.storage.local.get([storageKey], res),
    );
    const localProfiles = data[storageKey] || [];

    if (localProfiles.length === 0) {
      chrome.storage.local.set({
        scan_state: {
          status: "error",
          message: "No local image folder loaded for this user yet.",
        },
        is_scanning_active: false,
      });
      return;
    }

    let lastProcessedCount = 0;
    let noNewItemsCount = 0;
    let consecutiveHeightMatches = 0;
    let lastScrollHeight = 0;

    const maxScrollLoops = 150;

    for (let loop = 0; loop < maxScrollLoops; loop++) {
      if (!chrome.runtime?.id) break;

      const visibleElements = Array.from(
        document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'),
      ).filter((el) => !isInsideModal(el));

      // Phase 1: Set preliminary overlays on newly revealed items
      for (const el of visibleElements) {
        const href = el.getAttribute("href") || "";
        const segments = href.split("/").filter(Boolean);
        const shortcode =
          segments[1] === "p" || segments[1] === "reel"
            ? segments[2]
            : segments[1];

        if (shortcode && !processedUrlsCache.has(shortcode)) {
          if (
            typeof processingUrlsCache !== "undefined" &&
            !processingUrlsCache.has(shortcode)
          ) {
            processingUrlsCache.add(shortcode);
          }
          updateOrCreateOverlay(el, "🕒 PROCESSING...", "#e2a100");
        }
      }

      // Phase 2: Matrix comparison execution
      for (const el of visibleElements) {
        const img = el.querySelector("img");
        const href = el.getAttribute("href") || "";
        const segments = href.split("/").filter(Boolean);
        const shortcode =
          segments[1] === "p" || segments[1] === "reel"
            ? segments[2]
            : segments[1];

        if (
          shortcode &&
          img &&
          img.src &&
          !img.src.startsWith("blob:") &&
          !processedUrlsCache.has(shortcode)
        ) {
          chrome.storage.local.set({
            scan_state: {
              status: "progress",
              current: processedUrlsCache.size + 1,
              total: Math.max(
                visibleElements.length,
                processedUrlsCache.size + 1,
              ),
              log: `Processing layouts: evaluating item ${processedUrlsCache.size + 1}...`,
            },
          });

          try {
            const instaProfile = await convertUrlToColorProfile(img.src);
            const matchFound = localProfiles.some((localProfile) =>
              isProfileSimilar(localProfile, instaProfile),
            );

            if (typeof processingUrlsCache !== "undefined")
              processingUrlsCache.delete(shortcode);
            processedUrlsCache.add(shortcode);

            if (matchFound) {
              matchedUrlsCache.add(shortcode);
              totalMatchesFoundCounter++;
              updateOrCreateOverlay(el, "💾 MATCHED", "#0095f6");
            } else {
              unmatchedUrlsCache.add(shortcode);
              updateOrCreateOverlay(el, "❌ NO MATCH", "rgba(38, 38, 38, 0.7)");
            }
            el.classList.add("processed-by-ext");
          } catch (e) {
            if (typeof processingUrlsCache !== "undefined")
              processingUrlsCache.delete(shortcode);
            console.debug("Skipped unreadable asset payload block.");
          }
        }
      }

      applyCachedOverlays();

      const currentScrollHeight = document.body.scrollHeight;
      const currentProcessedCount = processedUrlsCache.size;

      if (currentProcessedCount > lastProcessedCount) {
        noNewItemsCount = 0;
        consecutiveHeightMatches = 0;
      } else {
        noNewItemsCount++;
        if (currentScrollHeight === lastScrollHeight) {
          consecutiveHeightMatches++;
        } else {
          consecutiveHeightMatches = 0;
        }
      }

      if (noNewItemsCount >= 4 || consecutiveHeightMatches >= 3) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((res) => setTimeout(res, 2200));

        if (
          processedUrlsCache.size === currentProcessedCount &&
          document.body.scrollHeight === currentScrollHeight
        ) {
          break;
        }
      }

      lastProcessedCount = currentProcessedCount;
      lastScrollHeight = currentScrollHeight;

      window.scrollTo(0, document.body.scrollHeight);

      const dynamicDelay = consecutiveHeightMatches > 0 ? 1600 : 1250;
      await new Promise((resolve) => setTimeout(resolve, dynamicDelay));
    }

    window.scrollTo({ top: 0, behavior: "smooth" });

    if (chrome.runtime?.id) {
      chrome.storage.local.set({
        scan_state: {
          status: "complete",
          matchesFound: totalMatchesFoundCounter,
        },
        is_scanning_active: false,
      });
    }
  } catch (err) {
    if (chrome.runtime?.id) {
      chrome.storage.local.set({
        scan_state: {
          status: "error",
          message: "Scan pipeline processing interrupted.",
        },
        is_scanning_active: false,
      });
    }
  }
}

function applyCachedOverlays() {
  const postContainers = Array.from(
    document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'),
  ).filter((el) => !isInsideModal(el));

  postContainers.forEach((container) => {
    const urlPath = container.getAttribute("href") || "";
    const segments = urlPath.split("/").filter(Boolean);
    const shortcode =
      segments[1] === "p" || segments[1] === "reel" ? segments[2] : segments[1];
    if (!shortcode) return;

    if (matchedUrlsCache.has(shortcode)) {
      updateOrCreateOverlay(container, "💾 MATCHED", "#0095f6");
      container.classList.add("processed-by-ext");
    } else if (unmatchedUrlsCache.has(shortcode)) {
      updateOrCreateOverlay(container, "❌ NO MATCH", "rgba(38, 38, 38, 0.7)");
      container.classList.add("processed-by-ext");
    } else if (processingUrlsCache.has(shortcode)) {
      updateOrCreateOverlay(container, "🕒 PROCESSING...", "#e2a100");
    }
  });
}

function convertUrlToColorProfile(url) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== "string") {
      return reject(new Error("Invalid target image reference URL."));
    }

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
        reject(new Error("Canvas context extraction failure."));
      }
    };
    img.onerror = (err) =>
      reject(
        new Error("Unable to parse asset destination target layout securely."),
      );
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

function updateOrCreateOverlay(containerElement, text, statusType) {
  containerElement.style.position = "relative";

  const existingBadges =
    containerElement.querySelectorAll(".insta-match-badge");
  let overlay = null;

  if (existingBadges.length > 0) {
    overlay = existingBadges[0];
    for (let i = 1; i < existingBadges.length; i++) {
      existingBadges[i].remove();
    }
  } else {
    overlay = document.createElement("div");
    overlay.className = "insta-match-badge";
    containerElement.appendChild(overlay);
  }

  let displayConfig = {
    text: "⋯ Processing",
    bg: "rgba(255, 255, 255, 0.7)",
    border: "rgba(255, 255, 255, 0.4)",
    color: "#1d1d1f",
  };

  if (text.includes("MATCHED")) {
    displayConfig = {
      text: "✓ Matched",
      bg: "rgba(52, 199, 89, 0.25)",
      border: "rgba(52, 199, 89, 0.4)",
      color: "#248a3d",
    };
  } else if (text.includes("NO MATCH")) {
    displayConfig = {
      text: "✕ Unmatched",
      bg: "rgba(255, 59, 48, 0.18)",
      border: "rgba(255, 59, 48, 0.35)",
      color: "#ff3b30",
    };
  }

  if (overlay.innerText !== displayConfig.text) {
    overlay.innerText = displayConfig.text;
  }

  Object.assign(overlay.style, {
    position: "absolute",
    bottom: "10px",
    right: "10px",
    backgroundColor: displayConfig.bg,
    color: displayConfig.color,
    border: `1px solid ${displayConfig.border}`,
    backdropFilter: "blur(16px) saturate(140%)",
    webkitBackdropFilter: "blur(16px) saturate(140%)",
    padding: "4px 10px",
    borderRadius: "20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "-0.1px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.06)",
    zIndex: "99",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    transition: "all 0.3s cubic-bezier(0.25, 1, 0.5, 1)",
  });
}
