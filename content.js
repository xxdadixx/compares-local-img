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

// 2. Operational Live View State Overlays Cache
const postMatchStatsCache = new Map(); // Maps shortcode -> { matchedCount, totalCount }
const processingUrlsCache = new Set();
let totalMatchesFoundCounter = 0;

function extractShortcode(href) {
  if (!href) return null;
  try {
    const urlObj = href.startsWith("http")
      ? new URL(href)
      : new URL(href, window.location.origin);
    const pathSegments = urlObj.pathname.split("/").filter(Boolean);
    const pIndex = pathSegments.indexOf("p");
    if (pIndex !== -1 && pathSegments[pIndex + 1])
      return pathSegments[pIndex + 1];
    const reelIndex = pathSegments.indexOf("reel");
    if (reelIndex !== -1 && pathSegments[reelIndex + 1])
      return pathSegments[reelIndex + 1];
  } catch (e) {
    /* fail-safe parsing constraint */
  }
  return null;
}

// 3. MutationObserver (Instantly hooks overlays as layouts render in view)
let scrollDebounceTimeout = null;
const observer = new MutationObserver(() => {
  if (!chrome.runtime?.id) {
    observer.disconnect();
    return;
  }
  clearTimeout(scrollDebounceTimeout);
  scrollDebounceTimeout = setTimeout(() => {
    applyCachedOverlays();
  }, 300);
});
if (document.documentElement) {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!chrome.runtime?.id) return;
  if (request.action === "scan_instagram") {
    sendResponse({ status: "acknowledged" });
    runBackgroundApiScan(request.tabId).catch((error) => {
      if (chrome.runtime?.id && request.tabId) {
        chrome.storage.local.set({
          [`scan_state_${request.tabId}`]: {
            status: "error",
            message: error.message || "Execution faulted.",
          },
          [`is_scanning_active_${request.tabId}`]: false,
        });
      }
    });
    return true;
  }
});

function getPageUsername() {
  const titleEl = document.querySelector(
    'header h2, header h1, h2[class*="Username"]',
  );
  if (titleEl?.textContent) return titleEl.textContent.trim().split(" ")[0];
  const paths = window.location.pathname.split("/").filter(Boolean);
  if (
    paths.length > 0 &&
    !["explore", "p", "stories", "reels", "reel", "direct"].includes(paths[0])
  )
    return paths[0];
  return null;
}

// 4. Background Fetch Integration Model Engine
async function runBackgroundApiScan(tabId) {
  if (!chrome.runtime?.id) return;
  const currentUsername = getPageUsername();
  if (!currentUsername) throw new Error("Not on a valid profile page.");

  postMatchStatsCache.clear();
  processingUrlsCache.clear();
  totalMatchesFoundCounter = 0;

  document
    .querySelectorAll(".processed-by-ext")
    .forEach((el) => el.classList.remove("processed-by-ext"));
  document
    .querySelectorAll(".insta-match-badge")
    .forEach((badge) => badge.remove());

  const data = await new Promise((res) =>
    chrome.storage.local.get([`insta_profile_${currentUsername}`], res),
  );
  const localProfiles = data[`insta_profile_${currentUsername}`] || [];
  if (localProfiles.length === 0) throw new Error("No folder data loaded.");

  // Resolve Profile Meta String to User ID Identification Key
  const profileResponse = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${currentUsername}`,
    {
      headers: {
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
      },
    },
  );
  if (!profileResponse.ok)
    throw new Error("API tracking request rejected by platform.");
  const profileJson = await profileResponse.json();
  const userId = profileJson?.data?.user?.id;
  if (!userId) throw new Error("Unable to map security tracking variables.");

  let allItems = [];
  let nextMaxId = "";
  let hasNextPage = true;
  let pageIndex = 0;

  // PHASE 1: Macro Payload Ingestion Loop
  while (hasNextPage) {
    if (!chrome.runtime?.id) return;
    pageIndex++;

    chrome.storage.local.set({
      [`scan_state_${tabId}`]: {
        status: "progress",
        phase: "fetching",
        fetchCurrent: pageIndex,
        fetchTotal: pageIndex + 1,
        compareCurrent: 0,
        compareTotal: 0,
        log: `Synchronizing platform indexes (Page Milestone ${pageIndex})...`,
      },
    });

    let feedUrl = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=33`;
    if (nextMaxId) feedUrl += `&max_id=${nextMaxId}`;

    const feedResponse = await fetch(feedUrl, {
      headers: {
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!feedResponse.ok) break;

    const feedData = await feedResponse.json();
    const items = feedData.items || [];
    if (items.length === 0) break;

    allItems = allItems.concat(items);
    hasNextPage = feedData.more_available;
    nextMaxId = feedData.next_max_id;

    await new Promise((res) => setTimeout(res, 1000));
  }

  // PHASE 2: Granular Signature Check Engine
  const totalPosts = allItems.length;
  let evaluateIndex = 0;

  for (const item of allItems) {
    if (!chrome.runtime?.id) return;
    evaluateIndex++;
    const shortcode = item.code;
    if (!shortcode) continue;

    processingUrlsCache.add(shortcode);
    chrome.storage.local.set({
      [`scan_state_${tabId}`]: {
        status: "progress",
        phase: "comparing",
        fetchCurrent: 1,
        fetchTotal: 1,
        compareCurrent: evaluateIndex,
        compareTotal: totalPosts,
        log: `Cross-checking pixel arrays: post ${evaluateIndex} of ${totalPosts}...`,
      },
    });

    const itemUrls = [];
    if (Array.isArray(item.carousel_media)) {
      item.carousel_media.forEach((m) => {
        if (m.image_versions2?.candidates?.[0]?.url)
          itemUrls.push(m.image_versions2.candidates[0].url);
      });
    } else if (item.image_versions2?.candidates?.[0]?.url) {
      itemUrls.push(item.image_versions2.candidates[0].url);
    }

    let matchedCount = 0;
    const totalCount = itemUrls.length;

    // Check every single slide image in order to collect the exact match counts
    for (const srcUrl of itemUrls) {
      try {
        const instaProfile = await convertUrlToColorProfile(srcUrl);
        if (localProfiles.some((p) => isProfileSimilar(p, instaProfile))) {
          matchedCount++;
        }
      } catch (e) {
        /* skip unreadable media candidates securely */
      }
    }

    processingUrlsCache.delete(shortcode);
    postMatchStatsCache.set(shortcode, { matchedCount, totalCount });

    if (matchedCount > 0) {
      totalMatchesFoundCounter++;
    }

    // Refresh layout view presentation elements concurrently
    applyCachedOverlays();
  }

  // Finalize Execution Pipeline Context
  chrome.storage.local.set({
    [`scan_state_${tabId}`]: {
      status: "complete",
      matchesFound: totalMatchesFoundCounter,
    },
    [`is_scanning_active_${tabId}`]: false,
  });
}

function applyCachedOverlays() {
  const postContainers = Array.from(
    document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'),
  ).filter((el) => !el.closest('div[role="dialog"]'));
  postContainers.forEach((container) => {
    const shortcode = extractShortcode(container.getAttribute("href"));
    if (!shortcode) return;

    if (postMatchStatsCache.has(shortcode)) {
      const { matchedCount, totalCount } = postMatchStatsCache.get(shortcode);
      if (matchedCount > 0) {
        updateOrCreateOverlay(container, "MATCHED", matchedCount, totalCount);
        container.classList.add("processed-by-ext");
      } else {
        updateOrCreateOverlay(container, "NOMATCH", matchedCount, totalCount);
        container.classList.add("processed-by-ext");
      }
    } else if (processingUrlsCache.has(shortcode)) {
      updateOrCreateOverlay(container, "PROCESSING", 0, 0);
    }
  });
}

function convertUrlToColorProfile(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = `${url}${url.includes("?") ? "&" : "?"}ext_cb=${Date.now()}`;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, 10, 10);
        resolve(Array.from(ctx.getImageData(0, 0, 10, 10).data));
      } else {
        reject(new Error("Canvas failure"));
      }
    };
    img.onerror = (err) => reject(err);
  });
}

function isProfileSimilar(profile1, profile2) {
  if (profile1.length !== profile2.length) return false;
  let diff = 0;
  for (let i = 0; i < profile1.length; i++) {
    if ((i + 1) % 4 === 0) continue;
    diff += Math.abs(profile1[i] - profile2[i]);
  }
  return diff / (profile1.length * 0.75) < 12;
}

function updateOrCreateOverlay(
  containerElement,
  statusType,
  matchedCount,
  totalCount,
) {
  containerElement.style.position = "relative";
  const existingBadges =
    containerElement.querySelectorAll(".insta-match-badge");
  let overlay = existingBadges.length > 0 ? existingBadges[0] : null;

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "insta-match-badge";
    containerElement.appendChild(overlay);
  }

  let config = {
    text: "⋯ Processing",
    bg: "rgba(255, 255, 255, 0.7)",
    border: "rgba(255, 255, 255, 0.4)",
    color: "#1d1d1f",
  };
  if (statusType === "MATCHED") {
    config = {
      text: `✓ Matched (${matchedCount}/${totalCount})`,
      bg: "rgba(52, 199, 89, 0.25)",
      border: "rgba(52, 199, 89, 0.4)",
      color: "#248a3d",
    };
  } else if (statusType === "NOMATCH") {
    config = {
      text: `✕ Unmatched (0/${totalCount})`,
      bg: "rgba(255, 59, 48, 0.18)",
      border: "rgba(255, 59, 48, 0.35)",
      color: "#ff3b30",
    };
  }

  if (overlay.innerText !== config.text) overlay.innerText = config.text;

  Object.assign(overlay.style, {
    position: "absolute",
    bottom: "10px",
    right: "10px",
    backgroundColor: config.bg,
    color: config.color,
    border: `1px solid ${config.border}`,
    backdropFilter: "blur(16px) saturate(140%)",
    webkitBackdropFilter: "blur(16px) saturate(140%)",
    padding: "4px 10px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: "600",
    zIndex: "99",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  });
}
