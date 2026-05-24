// inject.js
(function () {
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = args[0];

    if (typeof url === "string" && url.includes("/api/v1/feed/user/")) {
      try {
        // Clone response to avoid disturbing Instagram's native client state
        const clone = response.clone();
        const data = await clone.json();

        // Grab headers from the executed request context if accessible
        // Instagram requires specific internal tracking tokens
        window.postMessage(
          {
            type: "INSTA_API_INTERCEPTED",
            url: url,
            payload: data,
          },
          "*",
        );
      } catch (e) {
        // Fail-safe to avoid breaking native client execution flow
      }
    }
    return response;
  };
})();
