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
  
  // NEW: Robust, pagination-aware collection loop matching reference extension architecture
  async function extractAllPostsImmediately(username) {
    const postsMap = new Map();
  
    try {
      // Phase 1: Retrieve basic parameters and the primary timeline page
      const baseInfoUrl = `https://www.instagram.com/${username}/?__a=1&__d=dis`;
      const baseResponse = await fetch(baseInfoUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      
      if (baseResponse.ok) {
        const baseJson = await baseResponse.json();
        const userObj = baseJson.graphql?.user || baseJson.data?.user;
        
        if (userObj) {
          const userId = userObj.id;
          let timelineMedia = userObj.edge_owner_to_timeline_media;
          
          // Process the first set of items returned by the profile page initialization
          if (timelineMedia && timelineMedia.edges) {
            timelineMedia.edges.forEach(edge => {
              if (edge.node && edge.node.shortcode && edge.node.display_url) {
                postsMap.set(edge.node.shortcode, { shortcode: edge.node.shortcode, display_url: edge.node.display_url });
              }
            });
  
            // Phase 2: Follow pagination cursors sequentially to load next sets of items (up to 3 batches/approx 50 posts)
            let pageInfo = timelineMedia.page_info;
            let iterations = 0;
  
            while (pageInfo && pageInfo.has_next_page && pageInfo.end_cursor && iterations < 3) {
              iterations++;
              const nextQueryId = "8255288477873205"; // Verified operational profile feed query hash template
              const variables = encodeURIComponent(JSON.stringify({ id: userId, first: 12, after: pageInfo.end_cursor }));
              const nextUrl = `https://www.instagram.com/graphql/query/?query_doc_id=${nextQueryId}&variables=${variables}`;
              
              const nextResponse = await fetch(nextUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
              if (!nextResponse.ok) break;
  
              const nextData = await nextResponse.json();
              const currentMediaGroup = nextData.data?.user?.edge_owner_to_timeline_media;
              if (!currentMediaGroup || !currentMediaGroup.edges) break;
  
              currentMediaGroup.edges.forEach(edge => {
                if (edge.node && edge.node.shortcode && edge.node.display_url) {
                  postsMap.set(edge.node.shortcode, { shortcode: edge.node.shortcode, display_url: edge.node.display_url });
                }
              });
  
              pageInfo = currentMediaGroup.page_info;
              // Short stabilization pause to respect platform rate constraints
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
    } catch (err) {
      console.debug("Data API pipeline throttled. Using local DOM parse trace safety fallback.", err);
    }
  
    // FALLBACK ACCELERATION PATHWAY: Scrape visible page frames to merge any missed layout items
    const elements = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    elements.forEach((el) => {
      const img = el.querySelector("img");
      const href = el.getAttribute("href") || "";
      const segments = href.split("/").filter(Boolean);
      const shortcode = segments[1] === "p" || segments[1] === "reel" ? segments[2] : segments[1];
      
      if (img && img.src && shortcode && !img.src.startsWith("blob:")) {
        if (!postsMap.has(shortcode)) {
          postsMap.set(shortcode, { shortcode: shortcode, display_url: img.src });
        }
      }
    });
  
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
  
      const profilePosts = await extractAllPostsImmediately(currentUsername);
  
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