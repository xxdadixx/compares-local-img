chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!chrome.runtime?.id) return;
  
    if (request.action === "scan_instagram") {
      matchImages().then((count) => {
        sendResponse({ status: "complete", matchesFound: count });
      });
      return true; 
    }
  });
  
  // Automatically watch for dynamic scrolling and profile navigation shifts
  const observer = new MutationObserver(() => {
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }
  
    try {
      chrome.storage.local.get(null, () => {
        if (chrome.runtime.lastError) {
          observer.disconnect();
        } else {
          matchImages();
        }
      });
    } catch (e) {
      observer.disconnect();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  function getPageUsername() {
    const pathSegments = window.location.pathname.split('/').filter(segment => segment.length > 0);
    const ignoredPaths = ['explore', 'p', 'stories', 'reels', 'direct', 'developer'];
    if (pathSegments.length > 0 && !ignoredPaths.includes(pathSegments[0])) {
      return pathSegments[0];
    }
    return null;
  }
  
  let lastUsername = "";
  
  async function matchImages() {
    if (!chrome.runtime?.id) return 0;
  
    const currentUsername = getPageUsername();
    if (!currentUsername) return 0;
  
    if (currentUsername !== lastUsername) {
      document.querySelectorAll('.processed-by-ext').forEach(el => el.classList.remove('processed-by-ext'));
      document.querySelectorAll('.insta-match-badge').forEach(badge => badge.remove());
      lastUsername = currentUsername;
    }
  
    const storageKey = `insta_profile_${currentUsername}`;
    
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([storageKey], async (data) => {
          if (chrome.runtime.lastError || !chrome.runtime?.id) return resolve(0);
  
          const localProfiles = data[storageKey] || [];
          if (localProfiles.length === 0) return resolve(0); 
  
          // BUG FIX: Target the actual grid post containers instead of just 'img' tags
          const postContainers = document.querySelectorAll('article [style*="padding-bottom"], article a[href^="/p/"]');
          let newMatches = 0;
  
          for (let container of postContainers) {
            // Find the actual image element hidden inside this specific container
            const imgElement = container.querySelector('img');
            if (!imgElement || !imgElement.src) continue;
  
            if (container.classList.contains('processed-by-ext')) continue;
            container.classList.add('processed-by-ext');
  
            // 1. Immediately place the "Checking" overlay on top of the container box
            const badge = updateOrCreateOverlay(container, '⏳ CHECKING...', 'rgba(0, 0, 0, 0.75)');
  
            try {
              const instaProfile = await convertUrlToColorProfile(imgElement.src);
              const matchFound = localProfiles.some(localProfile => isProfileSimilar(localProfile, instaProfile));
  
              if (matchFound) {
                // 2. Update to Blue if a local match is confirmed
                updateOrCreateOverlay(container, '💾 MATCHED', '#0095f6', badge);
                newMatches++;
              } else {
                // 3. Update to Dark Gray if checked with no match found
                updateOrCreateOverlay(container, '❌ NO MATCH', 'rgba(38, 38, 38, 0.7)', badge);
              }
            } catch (e) {
              // 4. Update to Red if checking was blocked by security/network issues
              updateOrCreateOverlay(container, '⚠️ BLOCKED', '#ed4956', badge);
              console.debug("Failed to read image source canvas profile data.");
            }
          }
          resolve(newMatches);
        });
      } catch (err) {
        resolve(0);
      }
    });
  }
  
  function convertUrlToColorProfile(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous'; 
      img.src = url;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 10; 
        canvas.height = 10;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 10, 10);
          const imgData = ctx.getImageData(0, 0, 10, 10).data;
          resolve(Array.from(imgData));
        } else {
          reject(new Error("Canvas failure"));
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
  
  // BUG FIX: Forces container rendering rules to keep our status indicators cleanly visible
  function updateOrCreateOverlay(containerElement, text, backgroundColor, existingBadge = null) {
    containerElement.style.position = 'relative';
    
    const overlay = existingBadge || containerElement.querySelector('.insta-match-badge') || document.createElement('div');
    
    overlay.className = 'insta-match-badge';
    overlay.innerText = text;
    overlay.style.position = 'absolute';
    overlay.style.bottom = '12px';
    overlay.style.right = '12px';
    overlay.style.backgroundColor = backgroundColor;
    overlay.style.color = 'white';
    overlay.style.padding = '5px 10px';
    overlay.style.borderRadius = '4px';
    overlay.style.fontSize = '12px';
    overlay.style.fontWeight = 'bold';
    overlay.style.zIndex = '999'; // High z-index value avoids being covered up by Instagram's overlay wrappers
    overlay.style.pointerEvents = 'none'; 
    overlay.style.transition = 'all 0.2s ease';
  
    if (!existingBadge && !containerElement.querySelector('.insta-match-badge')) {
      containerElement.appendChild(overlay);
    }
    
    return overlay;
  }