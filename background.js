// background.js (Conceptual logic for background extraction)
async function fetchAllProfilePosts(userId, headers) {
  let allPosts = [];
  let nextMaxId = "";
  let hasNextPage = true;

  while (hasNextPage) {
    let url = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=30`;
    if (nextMaxId) url += `&max_id=${nextMaxId}`;

    const response = await fetch(url, { headers });
    const data = await response.json();

    // Collect post objects (containing shortcode, image URLs, etc.)
    allPosts = allPosts.concat(data.items);

    // Check pagination status
    hasNextPage = data.more_available;
    nextMaxId = data.next_max_id;

    // CRITICAL: Introduce a human-like delay (e.g., 1.5 - 2 seconds)
    // to mimic standard extensions and avoid 429 Rate-Limit bans.
    await new Promise((res) => setTimeout(res, 2000));
  }
  return allPosts;
}
