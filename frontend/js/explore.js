(() => {
  const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
  const POSTS_API = `${BACKEND_ORIGIN}/api/posts`;
  const USERS_API = `${BACKEND_ORIGIN}/api/users`;
  const POST_SHARE_PREFIX = "__ASCAPDX_POST_SHARE__::";
  const session = (window.APP_CONFIG && window.APP_CONFIG.getSession && window.APP_CONFIG.getSession()) || null;
  const username = session ? session.username : "";
  const uiFeedback = window.UIFeedback || null;
  const FEED_LIMIT = 140;

  const feedEl = document.getElementById("exploreFeed");
  const creatorsEl = document.getElementById("topCreators");
  const hashtagsEl = document.getElementById("topHashtags");
  const searchInput = document.getElementById("userSearchInput");
  const clearSearchBtn = document.getElementById("clearUserSearchBtn");
  const filterChips = Array.from(document.querySelectorAll("[data-explore-filter]"));
  const postViewer = document.getElementById("postViewer");
  const viewerBody = document.getElementById("viewerBody");
  const viewerCloseBtn = document.getElementById("viewerCloseBtn");
  const shareModal = document.getElementById("shareModal");
  const closeShareModalBtn = document.getElementById("closeShareModalBtn");
  const shareSearchInput = document.getElementById("shareSearchInput");
  const shareUserList = document.getElementById("shareUserList");
  const shareWhatsappBtn = document.getElementById("shareWhatsappBtn");
  const shareFacebookBtn = document.getElementById("shareFacebookBtn");
  const shareInstagramBtn = document.getElementById("shareInstagramBtn");

  let sourcePosts = [];
  let activeFilter = "all";
  let searchQuery = "";
  let currentViewerPostId = "";
  let savedPostIds = new Set();
  let sharePostId = "";
  let shareRecipients = [];
  let relations = { followers: [], following: [] };
  const socket = (username && session && session.userId && typeof io === "function")
    ? io(BACKEND_ORIGIN, (window.APP_CONFIG && window.APP_CONFIG.getSocketOptions && window.APP_CONFIG.getSocketOptions()) || { withCredentials: true })
    : null;

  function uiConfirm(message, options = {}) {
    if (uiFeedback && typeof uiFeedback.confirm === "function") {
      return uiFeedback.confirm(String(message || "Are you sure?"), options);
    }
    return Promise.resolve(window.confirm(String(message || "Are you sure?")));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("\uFFFD", "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function sanitizeUrl(url, fallback = "") {
    const raw = String(url || "").trim();
    if (!raw) return fallback;
    const allowed = ["http://", "https://", "/", "assets/", "./assets/", "blob:", "data:image/", "data:video/"];
    return allowed.some((prefix) => raw.startsWith(prefix)) ? raw : fallback;
  }

  function shortAlphabetName(name, fallback = "User") {
    const raw = String(name || "").replace(/[^A-Za-z]/g, "");
    if (raw) return raw.slice(0, 8);
    const fallbackRaw = String(fallback || "User").replace(/[^A-Za-z]/g, "");
    return (fallbackRaw || "User").slice(0, 8);
  }

  function getTimeAgo(isoDate) {
    const then = new Date(isoDate).getTime();
    if (!Number.isFinite(then)) return "just now";
    const diffSec = Math.max(1, Math.floor((Date.now() - then) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatCount(value) {
    const count = Number(value || 0);
    if (count >= 1000000) return `${(count / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
    return String(count);
  }

  function getPostById(postId) {
    return sourcePosts.find((post) => String(post.id) === String(postId)) || null;
  }

  function getShareUrl(postId) {
    const baseUrl = new URL("posts.html", window.location.href);
    return `${baseUrl.origin}${baseUrl.pathname}#post-${encodeURIComponent(String(postId || ""))}`;
  }

  async function fetchJson(url, options = {}) {
    const request = window.APP_CONFIG && window.APP_CONFIG.authFetch ? window.APP_CONFIG.authFetch : fetch;
    const res = await request(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
  }

  function getRoom(user1, user2) {
    return [String(user1 || ""), String(user2 || "")].sort().join("_");
  }

  function buildPostShareMessage(postId) {
    const post = getPostById(postId);
    if (!post) return null;
    const payload = {
      type: "post_share",
      postId: String(post.id || ""),
      authorUsername: String(post.authorUsername || ""),
      authorDisplayName: String(post.authorDisplayName || post.authorUsername || "User"),
      authorVerified: !!post.authorVerified,
      caption: String(post.caption || ""),
      mediaUrl: sanitizeUrl(post.mediaUrl, ""),
      mediaType: post.mediaType === "video" ? "video" : "image",
      createdAt: post.createdAt || null
    };
    return `${POST_SHARE_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
  }

  function getShareRecipients() {
    const map = new Map();
    const addUser = (raw) => {
      if (!raw) return;
      const uname = String(raw.username || raw.name || raw || "").trim();
      if (!uname || uname === username) return;
      if (!map.has(uname)) {
        map.set(uname, {
          username: uname,
          name: String(raw.name || raw.username || uname),
          avatarUrl: sanitizeUrl(raw.avatarUrl, "assets/default-avatar.svg")
        });
      }
    };

    (relations.followers || []).forEach(addUser);
    (relations.following || []).forEach(addUser);

    try {
      const knownRaw = localStorage.getItem("known_users");
      const known = knownRaw ? JSON.parse(knownRaw) : [];
      if (Array.isArray(known)) known.forEach((u) => addUser({ username: u, name: u }));
    } catch (err) {}

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderShareRecipients(query = "") {
    if (!shareUserList) return;
    const q = String(query || "").trim().toLowerCase();
    const shown = q
      ? shareRecipients.filter((u) => String(u.username || "").toLowerCase().includes(q) || String(u.name || "").toLowerCase().includes(q))
      : shareRecipients;

    if (!shown.length) {
      shareUserList.innerHTML = '<p class="empty-line">No users found.</p>';
      return;
    }

    shareUserList.innerHTML = shown.map((u) => `
      <div class="share-user">
        <div class="share-user-main">
          <img class="share-user-avatar" src="${escapeHtml(u.avatarUrl || "assets/default-avatar.svg")}" alt="${escapeHtml(u.username)} avatar" onerror="this.src='assets/default-avatar.svg'">
          <div class="share-user-name">${escapeHtml(u.name || u.username)} <span class="post-time">@${escapeHtml(u.username)}</span></div>
        </div>
        <button class="share-send-btn" type="button" data-share-user="${escapeHtml(u.username)}">Send</button>
      </div>
    `).join("");
  }

  function openShareModal(postId) {
    sharePostId = String(postId || "");
    if (!shareModal || !sharePostId) return;
    shareRecipients = getShareRecipients();
    if (shareSearchInput) shareSearchInput.value = "";
    renderShareRecipients("");
    shareModal.classList.add("show");
    shareModal.setAttribute("aria-hidden", "false");
    if (shareSearchInput) setTimeout(() => shareSearchInput.focus(), 20);
  }

  function closeShareModal() {
    if (!shareModal) return;
    shareModal.classList.remove("show");
    shareModal.setAttribute("aria-hidden", "true");
  }

  async function trackPostShare(postId) {
    const id = String(postId || "");
    if (!id) return;
    try {
      await fetchJson(`${POSTS_API}/${encodeURIComponent(id)}/share`, { method: "POST" });
    } catch (err) {}
  }

  async function sendPostToUser(targetUsername, triggerBtn = null) {
    const postId = String(sharePostId || "");
    const target = String(targetUsername || "").trim();
    if (!postId || !target || !socket) return;
    const message = buildPostShareMessage(postId);
    if (!message) return;
    const room = getRoom(username, target);

    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Sending...";
    }
    try {
      socket.emit("joinRoom", room);
      socket.emit("sendMessage", {
        sender: username,
        receiver: target,
        message,
        room,
        isFile: false
      });
      await trackPostShare(postId);
      if (triggerBtn) triggerBtn.textContent = "Sent";
    } finally {
      if (triggerBtn) {
        setTimeout(() => {
          triggerBtn.disabled = false;
          triggerBtn.textContent = "Send";
        }, 1200);
      }
    }
  }

  async function loadRelations() {
    if (!username) return;
    try {
      const profile = await fetchJson(`${USERS_API}/profile/${encodeURIComponent(username)}`);
      relations = {
        followers: Array.isArray(profile.followers) ? profile.followers : [],
        following: Array.isArray(profile.following) ? profile.following : []
      };
    } catch (err) {
      relations = { followers: [], following: [] };
    }
  }

  async function loadSavedPosts() {
    if (!username) {
      savedPostIds = new Set();
      return;
    }
    try {
      const request = window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${POSTS_API}/saved`)
        : fetch(`${POSTS_API}/saved`, {
          headers: {}
        });
      const res = await request;
      const data = await res.json().catch(() => []);
      if (!res.ok) return;
      const ids = Array.isArray(data) ? data.map((post) => String(post.id || post._id || "")) : [];
      savedPostIds = new Set(ids.filter(Boolean));
    } catch (err) {}
  }

  async function fetchBookmarkCollections() {
    const req = window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${USERS_API}/bookmarks/collections`)
      : fetch(`${USERS_API}/bookmarks/collections`, {
          headers: {}
        });
    const res = await req;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Could not load collections");
    return Array.isArray(data.items) ? data.items : [];
  }

  async function savePostToCollection(postId) {
    const collections = await fetchBookmarkCollections();
    if (!collections.length) throw new Error("No collections yet. Create one in Settings.");
    const names = collections.map((c) => String(c.name || "")).filter(Boolean);
    const picked = window.prompt(`Save to collection:\n${names.join(", ")}`, names[0] || "");
    if (picked === null) return false;
    const target = String(picked || "").trim();
    if (!target) return false;
    const exact = names.find((n) => n.toLowerCase() === target.toLowerCase()) || target;
    await fetchJson(`${USERS_API}/bookmarks/collections/${encodeURIComponent(exact)}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId })
    });
    return true;
  }

  function getHashtags(caption) {
    const tags = String(caption || "").match(/#[a-z0-9_]+/gi);
    if (!tags) return [];
    return tags.map((tag) => tag.toLowerCase());
  }

  function scorePost(post) {
    const breakdown = getScoreBreakdown(post);
    return breakdown.total;
  }

  function getScoreBreakdown(post) {
    const likes = Number(post.likesCount || (Array.isArray(post.likedBy) ? post.likedBy.length : 0) || 0);
    const comments = Number(
      post.commentsCount
      || (Array.isArray(post.comments) ? post.comments.length : 0)
      || 0
    );
    const shares = Number(post.sharesCount || 0);
    const saves = Number(post.savesCount || 0);

    const likeScore = likes * 5;
    const commentScore = comments * 8;
    const shareScore = shares * 15;
    const saveScore = saves * 4;

    return {
      likes,
      comments,
      shares,
      saves,
      likeScore,
      commentScore,
      shareScore,
      saveScore,
      total: likeScore + commentScore + shareScore + saveScore
    };
  }

  function normalizePost(raw) {
    return {
      id: String(raw.id || raw._id || ""),
      authorUsername: String(raw.authorUsername || ""),
      authorDisplayName: String(raw.authorDisplayName || raw.authorUsername || "Unknown"),
      authorAvatarUrl: sanitizeUrl(raw.authorAvatarUrl, "assets/default-avatar.svg"),
      caption: String(raw.caption || ""),
      mediaUrl: sanitizeUrl(raw.mediaUrl, ""),
      mediaType: raw.mediaType === "video" ? "video" : "image",
      privacy: String(raw.privacy || "public"),
      likesCount: Number(raw.likesCount || 0),
      commentsCount: Array.isArray(raw.comments) ? raw.comments.length : Number(raw.commentsCount || 0),
      sharesCount: Number(raw.sharesCount || 0),
      savesCount: Number(raw.savesCount || 0),
      likedBy: Array.isArray(raw.likedBy) ? raw.likedBy : [],
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      createdAt: raw.createdAt || new Date().toISOString(),
      score: scorePost(raw)
    };
  }

  function applyFilters(posts) {
    const q = searchQuery.trim().toLowerCase();
    return posts
      .filter((post) => {
        if (activeFilter !== "all" && post.mediaType !== activeFilter) return false;
        if (!q) return true;
        const hashtags = getHashtags(post.caption).join(" ");
        const haystack = `${post.authorUsername} ${post.authorDisplayName} ${post.caption} ${hashtags}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  function renderFeed(posts) {
    if (!feedEl) return;

    if (!posts.length) {
      feedEl.innerHTML = '<p class="empty-line">No posts match your current filters.</p>';
      return;
    }

    feedEl.innerHTML = posts.slice(0, 80).map((post) => {
      const authorUsername = escapeHtml(post.authorUsername || "user");
      const media = post.mediaType === "video"
        ? `
          <div class="video-player" data-video-player>
            <video class="post-media" src="${escapeHtml(post.mediaUrl)}" preload="metadata" playsinline loop></video>
          </div>
        `
        : `<img class="post-media" src="${escapeHtml(post.mediaUrl)}" alt="Post by ${authorUsername}" loading="lazy" onerror="this.style.display='none'">`;

      return `
        <article class="post-card" id="post-${escapeHtml(post.id)}" data-open-post="${escapeHtml(post.id)}" role="link" tabindex="0" aria-label="Open post">
          ${media}
        </article>
      `;
    }).join("");

    initVideoPlayers();
  }

  function renderViewerContent() {
    if (!viewerBody) return;
    const post = getPostById(currentViewerPostId);
    if (!post) {
      viewerBody.innerHTML = '<p class="empty-line">Post not found.</p>';
      return;
    }

    const authorUsername = escapeHtml(post.authorUsername || "user");
    const authorDisplay = escapeHtml(shortAlphabetName(post.authorDisplayName || post.authorUsername || "User", post.authorUsername || "User"));
    const authorAvatar = escapeHtml(sanitizeUrl(post.authorAvatarUrl, "assets/default-avatar.svg"));
    const likedByMe = Array.isArray(post.likedBy) && post.likedBy.includes(username);
    const isSaved = savedPostIds.has(String(post.id));
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const media = post.mediaType === "video"
      ? `<div class="viewer-media-wrap"><video class="viewer-media" src="${escapeHtml(post.mediaUrl)}" controls playsinline preload="metadata" loop></video></div>`
      : `<div class="viewer-media-wrap"><img class="viewer-media" src="${escapeHtml(post.mediaUrl)}" alt="Post by ${authorUsername}"></div>`;

    viewerBody.innerHTML = `
      ${media}
      <div class="viewer-meta">
        <a class="viewer-user" href="user-profile.html?u=${encodeURIComponent(post.authorUsername || "")}">
          <img src="${authorAvatar}" alt="${authorUsername} avatar" onerror="this.src='assets/default-avatar.svg'">
          <span>${authorDisplay} <span class="post-time">@${authorUsername}</span></span>
        </a>
        <p class="viewer-caption">${escapeHtml(post.caption || "") || "No caption."}</p>
        <div class="post-actions">
          <div class="post-actions-left">
            <button type="button" class="post-action-btn action-like ${likedByMe ? "active" : ""}" data-viewer-like="${escapeHtml(post.id)}">
              <i class="bi ${likedByMe ? "bi-heart-fill" : "bi-heart"}"></i><span>Like</span>
            </button>
            <button type="button" class="post-action-btn action-save ${isSaved ? "active" : ""}" data-viewer-save="${escapeHtml(post.id)}">
              <i class="bi ${isSaved ? "bi-bookmark-fill" : "bi-bookmark"}"></i><span>${isSaved ? "Saved" : "Save"}</span>
            </button>
            <button type="button" class="post-action-btn action-share" data-viewer-share="${escapeHtml(post.id)}">
              <i class="bi bi-send"></i><span>Share</span>
            </button>
          </div>
        </div>
        <p class="viewer-sub">${formatCount(post.likesCount)} likes - ${formatCount(comments.length)} comments - ${getTimeAgo(post.createdAt)}</p>
        <form id="viewerCommentForm" data-viewer-comment-form="${escapeHtml(post.id)}" class="comment-form" style="margin-top:0;">
          <input class="form-control" name="comment" maxlength="400" placeholder="Write a comment and press send..." required>
          <button class="btn-comment is-active" type="submit" aria-label="Send comment"><i class="bi bi-send-fill"></i></button>
        </form>
        <div class="comments-list">
          ${comments.length ? comments.map((c) => `
            <div class="comment-item">
              <div class="comment-row">
                <div><strong>@${escapeHtml(c.username || "user")}</strong> ${escapeHtml(c.text || "")}<span>${getTimeAgo(c.createdAt)}</span></div>
                ${
                  (String(c.username || "") === username || String(post.authorUsername || "") === username)
                    ? `<button type="button" class="btn-delete" data-viewer-delete-comment="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id || c._id || "")}">Delete</button>`
                    : ""
                }
              </div>
            </div>
          `).join("") : '<p class="empty-line" style="margin:0;">No comments yet.</p>'}
        </div>
        <p id="viewerStatus" class="viewer-sub"></p>
      </div>
    `;
  }

  function openPostViewer(postId) {
    if (!postViewer || !viewerBody) return;
    currentViewerPostId = String(postId || "");
    renderViewerContent();
    postViewer.classList.add("show");
    postViewer.setAttribute("aria-hidden", "false");
  }

  function closePostViewer() {
    if (!postViewer) return;
    postViewer.classList.remove("show");
    postViewer.setAttribute("aria-hidden", "true");
  }

  function updatePostById(postId, updater) {
    sourcePosts = sourcePosts.map((post) => {
      if (String(post.id) !== String(postId)) return post;
      const next = typeof updater === "function" ? updater(post) : post;
      return { ...next, commentsCount: Array.isArray(next.comments) ? next.comments.length : Number(next.commentsCount || 0), score: scorePost(next) };
    });
  }

  function initVideoPlayers() {
    document.querySelectorAll("[data-video-player]").forEach((player) => {
      if (player.dataset.bound === "1") return;
      player.dataset.bound = "1";

      const video = player.querySelector("video");
      if (!video) return;

      video.autoplay = false;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.controls = false;

      const startPlayback = () => {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
      };

      const stopPlayback = () => {
        try {
          video.pause();
        } catch (err) {}
        video.currentTime = 0;
      };

      player.addEventListener("mouseenter", startPlayback);
      player.addEventListener("mouseleave", stopPlayback);
      player.addEventListener("focusin", startPlayback);
      player.addEventListener("focusout", stopPlayback);
      player.addEventListener("touchstart", startPlayback, { passive: true });

      stopPlayback();
    });
  }

  function renderCreators(posts) {
    if (!creatorsEl) return;

    const map = new Map();
    posts.forEach((post) => {
      const uname = String(post.authorUsername || "");
      if (!uname) return;
      if (!map.has(uname)) {
        map.set(uname, {
          username: uname,
          displayName: String(post.authorDisplayName || uname),
          avatarUrl: post.authorAvatarUrl || "assets/default-avatar.svg",
          score: 0,
          posts: 0
        });
      }
      const entry = map.get(uname);
      entry.posts += 1;
      entry.score += Number(post.score || 0);
    });

    const ranked = Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (!ranked.length) {
      creatorsEl.innerHTML = '<p class="empty-line">No creator data yet.</p>';
      return;
    }

    creatorsEl.innerHTML = ranked.map((entry, index) => `
      <article class="rank-item">
        <div class="rank-main">
          <span class="rank-order">#${index + 1}</span>
          <img src="${escapeHtml(entry.avatarUrl)}" alt="${escapeHtml(entry.username)} avatar" class="post-avatar" style="width:26px;height:26px;" onerror="this.src='assets/default-avatar.svg'">
          <div style="min-width:0;">
            <a href="user-profile.html?u=${encodeURIComponent(entry.username)}" style="color:#eaf5ff;text-decoration:none;">${escapeHtml(entry.displayName)}</a>
            <div class="post-time">@${escapeHtml(entry.username)} - ${entry.posts} posts</div>
          </div>
        </div>
        <span class="rank-score">${Math.round(entry.score)} pts</span>
      </article>
    `).join("");
  }

  function renderHashtags(posts) {
    if (!hashtagsEl) return;

    const map = new Map();
    posts.forEach((post) => {
      getHashtags(post.caption).forEach((tag) => {
        map.set(tag, (map.get(tag) || 0) + 1);
      });
    });

    const ranked = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (!ranked.length) {
      hashtagsEl.innerHTML = '<p class="empty-line">No hashtags yet.</p>';
      return;
    }

    hashtagsEl.innerHTML = ranked.map(([tag, count], index) => `
      <article class="rank-item">
        <div class="rank-main">
          <span class="rank-order">#${index + 1}</span>
          <button type="button" data-tag-filter="${escapeHtml(tag)}" style="border:0;background:transparent;color:#9dd8ff;padding:0;cursor:pointer;">${escapeHtml(tag)}</button>
        </div>
        <span class="rank-score">${count} posts</span>
      </article>
    `).join("");
  }

  function renderAll() {
    const filtered = applyFilters(sourcePosts);
    renderFeed(filtered);
    renderCreators(filtered);
    renderHashtags(filtered);
  }

  function syncFilterUi() {
    filterChips.forEach((chip) => {
      const value = chip.getAttribute("data-explore-filter") || "all";
      chip.classList.toggle("active", value === activeFilter);
    });
  }

  function syncSearchUi() {
    if (!clearSearchBtn) return;
    clearSearchBtn.classList.toggle("show", !!searchQuery.trim());
  }

  async function loadPosts() {
    try {
      const request = window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${POSTS_API}?limit=${FEED_LIMIT}`)
        : fetch(`${POSTS_API}?limit=${FEED_LIMIT}`);
      const res = await request;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load posts");
      sourcePosts = (Array.isArray(data) ? data : []).map(normalizePost);
      renderAll();
    } catch (err) {
      if (feedEl) {
        feedEl.innerHTML = `<p class="empty-line">${escapeHtml(err.message || "Could not load feed.")}</p>`;
      }
      if (creatorsEl) creatorsEl.innerHTML = '<p class="empty-line">Unavailable.</p>';
      if (hashtagsEl) hashtagsEl.innerHTML = '<p class="empty-line">Unavailable.</p>';
    }
  }

  function bindEvents() {
    filterChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        activeFilter = chip.getAttribute("data-explore-filter") || "all";
        syncFilterUi();
        renderAll();
      });
    });

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value || "";
        syncSearchUi();
        renderAll();
      });
    }

    if (clearSearchBtn && searchInput) {
      clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchQuery = "";
        syncSearchUi();
        renderAll();
        searchInput.focus();
      });
    }

    if (hashtagsEl && searchInput) {
      hashtagsEl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-tag-filter]");
        if (!button) return;
        const tag = button.getAttribute("data-tag-filter") || "";
        searchQuery = tag;
        searchInput.value = tag;
        syncSearchUi();
        renderAll();
      });
    }

    if (feedEl) {
      feedEl.addEventListener("click", (event) => {
        const card = event.target.closest("[data-open-post]");
        if (!card) return;
        const postId = card.getAttribute("data-open-post");
        if (!postId) return;
        openPostViewer(postId);
      });

      feedEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target.closest("[data-open-post]");
        if (!card) return;
        event.preventDefault();
        const postId = card.getAttribute("data-open-post");
        if (!postId) return;
        openPostViewer(postId);
      });
    }

    if (viewerCloseBtn) {
      viewerCloseBtn.addEventListener("click", closePostViewer);
    }

    if (postViewer) {
      postViewer.addEventListener("click", (event) => {
        if (event.target === postViewer) closePostViewer();
      });
    }

    if (closeShareModalBtn) {
      closeShareModalBtn.addEventListener("click", closeShareModal);
    }

    if (shareModal) {
      shareModal.addEventListener("click", (event) => {
        if (event.target === shareModal) closeShareModal();
      });
    }

    if (shareSearchInput) {
      shareSearchInput.addEventListener("input", () => {
        renderShareRecipients(shareSearchInput.value);
      });
    }

    if (shareUserList) {
      shareUserList.addEventListener("click", async (event) => {
        const sendBtn = event.target.closest("[data-share-user]");
        if (!sendBtn) return;
        const targetUser = sendBtn.getAttribute("data-share-user");
        if (!targetUser) return;
        await sendPostToUser(targetUser, sendBtn);
      });
    }

    if (shareWhatsappBtn) {
      shareWhatsappBtn.addEventListener("click", async () => {
        if (!sharePostId) return;
        await trackPostShare(sharePostId);
        const shareUrl = getShareUrl(sharePostId);
        const text = `Check this post on ASCAPDX Digital: ${shareUrl}`;
        const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(waUrl, "_blank", "noopener,noreferrer");
      });
    }

    if (shareFacebookBtn) {
      shareFacebookBtn.addEventListener("click", async () => {
        if (!sharePostId) return;
        await trackPostShare(sharePostId);
        const shareUrl = getShareUrl(sharePostId);
        const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
        window.open(fbUrl, "_blank", "noopener,noreferrer");
      });
    }

    if (shareInstagramBtn) {
      shareInstagramBtn.addEventListener("click", async () => {
        if (!sharePostId) return;
        await trackPostShare(sharePostId);
        const shareUrl = getShareUrl(sharePostId);
        const text = `Check this post on ASCAPDX Digital: ${shareUrl}`;
        let copied = false;
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(text);
            copied = true;
          }
        } catch (err) {
          copied = false;
        }
        window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
        const status = document.getElementById("viewerStatus");
        if (status) {
          status.textContent = copied
            ? "Instagram opened. Link copied, paste it in your post or story."
            : "Instagram opened. Copy the post link and paste it in your post or story.";
        }
      });
    }

    if (viewerBody) {
      viewerBody.addEventListener("click", async (event) => {
        const likeBtn = event.target.closest("[data-viewer-like]");
        if (likeBtn) {
          const postId = String(likeBtn.getAttribute("data-viewer-like") || "");
          if (!postId) return;
          likeBtn.disabled = true;
          try {
            const data = await fetchJson(`${POSTS_API}/${encodeURIComponent(postId)}/like`, { method: "POST" });
            updatePostById(postId, (post) => {
              const likedBy = Array.isArray(post.likedBy) ? [...post.likedBy] : [];
              const hasLiked = likedBy.includes(username);
              let nextLikedBy = likedBy;
              if (data.liked && !hasLiked) nextLikedBy.push(username);
              if (!data.liked && hasLiked) nextLikedBy = likedBy.filter((u) => u !== username);
              return { ...post, likedBy: nextLikedBy, likesCount: Number(data.likesCount || nextLikedBy.length) };
            });
            renderViewerContent();
            renderAll();
          } catch (err) {
            const status = document.getElementById("viewerStatus");
            if (status) status.textContent = err.message || "Could not like post.";
          } finally {
            likeBtn.disabled = false;
          }
          return;
        }

        const saveBtn = event.target.closest("[data-viewer-save]");
        if (saveBtn) {
          const postId = String(saveBtn.getAttribute("data-viewer-save") || "");
          if (!postId) return;
          saveBtn.disabled = true;
          try {
            const data = await fetchJson(`${POSTS_API}/${encodeURIComponent(postId)}/save`, { method: "POST" });
            if (data.saved) savedPostIds.add(postId);
            else savedPostIds.delete(postId);
            updatePostById(postId, (post) => ({ ...post, savesCount: Number(data.savesCount || post.savesCount || 0) }));
            if (data.saved) {
              const status = document.getElementById("viewerStatus");
              const alsoSave = await uiConfirm("Save to one of your collections too?");
              if (alsoSave) {
                try {
                  const added = await savePostToCollection(postId);
                  if (status && added) status.textContent = "Saved to collection.";
                } catch (collectionErr) {
                  if (status) status.textContent = collectionErr.message || "Could not save to collection.";
                }
              }
            }
            renderViewerContent();
            renderAll();
          } catch (err) {
            const status = document.getElementById("viewerStatus");
            if (status) status.textContent = err.message || "Could not save post.";
          } finally {
            saveBtn.disabled = false;
          }
          return;
        }

        const shareBtn = event.target.closest("[data-viewer-share]");
        if (shareBtn) {
          const postId = String(shareBtn.getAttribute("data-viewer-share") || "");
          if (!postId) return;
          openShareModal(postId);
          return;
        }

        const deleteCommentBtn = event.target.closest("[data-viewer-delete-comment]");
        if (deleteCommentBtn) {
          const postId = String(deleteCommentBtn.getAttribute("data-viewer-delete-comment") || "");
          const commentId = String(deleteCommentBtn.getAttribute("data-comment-id") || "");
          if (!postId || !commentId || !(await uiConfirm("Delete this comment?", { tone: "danger", okText: "Delete" }))) return;
          deleteCommentBtn.disabled = true;
          try {
            await fetchJson(`${POSTS_API}/${encodeURIComponent(postId)}/comment/${encodeURIComponent(commentId)}`, { method: "DELETE" });
            updatePostById(postId, (post) => ({
              ...post,
              comments: (post.comments || []).filter((c) => String(c.id || c._id || "") !== commentId)
            }));
            renderViewerContent();
            renderAll();
          } catch (err) {
            const status = document.getElementById("viewerStatus");
            if (status) status.textContent = err.message || "Could not delete comment.";
          } finally {
            deleteCommentBtn.disabled = false;
          }
        }
      });

      viewerBody.addEventListener("submit", async (event) => {
        const form = event.target.closest("[data-viewer-comment-form]");
        if (!form) return;
        event.preventDefault();
        const postId = String(form.getAttribute("data-viewer-comment-form") || "");
        const input = form.querySelector('input[name="comment"]');
        const text = String((input && input.value) || "").trim();
        if (!postId || !text) return;
        const submitBtn = form.querySelector("button[type='submit']");
        if (submitBtn) submitBtn.disabled = true;
        try {
          const data = await fetchJson(`${POSTS_API}/${encodeURIComponent(postId)}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
          });
          if (input) input.value = "";
          updatePostById(postId, (post) => ({
            ...post,
            comments: [...(post.comments || []), data.comment]
          }));
          renderViewerContent();
          renderAll();
        } catch (err) {
          const status = document.getElementById("viewerStatus");
          if (status) status.textContent = err.message || "Could not add comment.";
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && postViewer && postViewer.classList.contains("show")) {
        closePostViewer();
      }
      if (event.key === "Escape" && shareModal && shareModal.classList.contains("show")) {
        closeShareModal();
      }
    });
  }

  function init() {
    syncFilterUi();
    syncSearchUi();
    bindEvents();
    Promise.all([loadSavedPosts(), loadRelations()]).finally(() => loadPosts());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


