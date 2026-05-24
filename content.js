chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!chrome.runtime?.id) return;

  if (request.action === "scan_instagram") {
    // Acknowledge receipt instantly to prevent port closure timeout bugs
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

// Real-time overlay layout tracking observer
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

let matchedUrlsCache = new Set();
let unmatchedUrlsCache = new Set();
let totalMatchesFoundCounter = 0;

function extractPostsFromDOM() {
  const posts = [];
  const backupContainers = document.querySelectorAll(
    'article a[href^="/p/"], article a[href^="/reel/"]',
  );

  backupContainers.forEach((el) => {
    const img = el.querySelector("img");
    const href = el.getAttribute("href") || "";
    const shortcode = href.split("/").filter(Boolean)[1];
    if (img && img.src && shortcode && !img.src.startsWith("blob:")) {
      posts.push({ shortcode: shortcode, display_url: img.src });
    }
  });
  return posts;
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

  matchedUrlsCache.clear();
  unmatchedUrlsCache.clear();
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

    // Instantly query all post containers present on the client screen
    const profilePosts = extractPostsFromDOM();

    if (profilePosts.length === 0) {
      chrome.storage.local.set({
        scan_state: {
          status: "error",
          message: "No post targets found on page. Try refreshing.",
        },
        is_scanning_active: false,
      });
      return;
    }

    let processedCount = 0;
    for (const post of profilePosts) {
      processedCount++;

      if (!chrome.runtime?.id) break;

      // Safely broadcast updates using state mutations
      chrome.storage.local.set({
        scan_state: {
          status: "progress",
          current: processedCount,
          total: profilePosts.length,
          log: `Analyzing post element ${processedCount} of ${profilePosts.length}...`,
        },
      });

      chrome.runtime
        .sendMessage({
          action: "scan_progress",
          current: processedCount,
          total: profilePosts.length,
          log: `Analyzing post layout element ${processedCount} of ${profilePosts.length}...`,
        })
        .catch(() => {});

      try {
        const instaProfile = await convertUrlToColorProfile(post.display_url);
        const matchFound = localProfiles.some((localProfile) =>
          isProfileSimilar(localProfile, instaProfile),
        );

        if (matchFound) {
          matchedUrlsCache.add(post.shortcode);
          totalMatchesFoundCounter++;
        } else {
          unmatchedUrlsCache.add(post.shortcode);
        }
      } catch (e) {
        console.debug("Skip individual image link parsing block.");
      }
    }

    applyCachedOverlays();

    if (chrome.runtime?.id) {
      // Broadcast clean completion state directly into local partition storage
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
          message: "An unexpected layout evaluation error occurred.",
        },
        is_scanning_active: false,
      });
    }
  }
}

function applyCachedOverlays() {
  const postContainers = document.querySelectorAll(
    'article a[href^="/p/"], article a[href^="/reel/"]',
  );

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
