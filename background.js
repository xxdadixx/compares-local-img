// background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    is_scanning_active: false,
    scan_state: { status: "idle" },
  });
});
