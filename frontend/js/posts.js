const session = (window.APP_CONFIG && window.APP_CONFIG.requireAuth && window.APP_CONFIG.requireAuth()) || null;
const username = session ? session.username : "";
const userId = session ? session.userId : "";

const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
const API_BASE = `${BACKEND_ORIGIN}/api/posts`;
const USERS_API = `${BACKEND_ORIGIN}/api/users`;
const STORIES_API = `${BACKEND_ORIGIN}/api/stories`;
const REPORTS_API = `${BACKEND_ORIGIN}/api/reports`;
const uiFeedback = window.UIFeedback || null;

function uiConfirm(message, options = {}) {
  if (uiFeedback && typeof uiFeedback.confirm === "function") {
    return uiFeedback.confirm(String(message || "Are you sure?"), options);
  }
  return Promise.resolve(window.confirm(String(message || "Are you sure?")));
}

const postForm = document.getElementById("postForm");
const mediaInput = document.getElementById("mediaInput");
const captionInput = document.getElementById("captionInput");
const privacyInput = document.getElementById("privacyInput");
const uploadBtn = document.getElementById("uploadBtn");
const loaderWrap = document.getElementById("loaderWrap");
const loaderBar = document.getElementById("loaderBar");
const loaderText = document.getElementById("loaderText");
const uploadStatus = document.getElementById("uploadStatus");
const feed = document.getElementById("feed");
const userSearchInput = document.getElementById("userSearchInput");
const clearUserSearchBtn = document.getElementById("clearUserSearchBtn");
const openCreateBtn = document.getElementById("openCreateBtn");
const createChoiceMenu = document.getElementById("createChoiceMenu");
const createPostChoiceBtn = document.getElementById("createPostChoiceBtn");
const createStoryChoiceBtn = document.getElementById("createStoryChoiceBtn");
const feedFilters = document.getElementById("feedFilters");
const feedSortSelect = document.getElementById("feedSortSelect");
const followersList = document.getElementById("followersList");
const followingList = document.getElementById("followingList");
const shareModal = document.getElementById("shareModal");
const closeShareModalBtn = document.getElementById("closeShareModalBtn");
const shareSearchInput = document.getElementById("shareSearchInput");
const shareUserList = document.getElementById("shareUserList");
const shareWhatsappBtn = document.getElementById("shareWhatsappBtn");
const shareFacebookBtn = document.getElementById("shareFacebookBtn");
const shareInstagramBtn = document.getElementById("shareInstagramBtn");
const storyMediaInput = document.getElementById("storyMediaInput");
const storiesRail = document.getElementById("storiesRail");
const storyUploadLoader = document.getElementById("storyUploadLoader");
const storyUploadText = document.getElementById("storyUploadText");
const storyUploadBar = document.getElementById("storyUploadBar");
const storyViewerModal = document.getElementById("storyViewerModal");
const closeStoryViewerBtn = document.getElementById("closeStoryViewerBtn");
const deleteStoryBtn = document.getElementById("deleteStoryBtn");
const storyPrevBtn = document.getElementById("storyPrevBtn");
const storyNextBtn = document.getElementById("storyNextBtn");
const storyViewerAvatar = document.getElementById("storyViewerAvatar");
const storyViewerName = document.getElementById("storyViewerName");
const storyViewerTime = document.getElementById("storyViewerTime");
const storyViewerMediaWrap = document.getElementById("storyViewerMediaWrap");
const storyProgress = document.getElementById("storyProgress");
const storyReactionsBar = document.getElementById("storyReactionsBar");
const storyReplyForm = document.getElementById("storyReplyForm");
const storyReplyInput = document.getElementById("storyReplyInput");
const storyReplySendBtn = document.getElementById("storyReplySendBtn");
const storyInteractionsBtn = document.getElementById("storyInteractionsBtn");
const storyInteractionsPanel = document.getElementById("storyInteractionsPanel");

const socket = (session && session.username && session.userId && typeof io === "function")
  ? io(BACKEND_ORIGIN, (window.APP_CONFIG && window.APP_CONFIG.getSocketOptions && window.APP_CONFIG.getSocketOptions()) || { withCredentials: true })
  : null;
const POST_SHARE_PREFIX = "__ASCAPDX_POST_SHARE__::";

let allPosts = [];
let activeTypeFilter = "all";
let activeSort = "newest";
let commentsExpanded = new Set();
let commentsPanelOpen = new Set();
let replyFormsOpen = new Set();
let relations = { followers: [], following: [] };
let onlineUsersSet = new Set();
const savedPostsKey = `saved_posts_${username}`;
let savedPostIds = new Set();
let sharePostId = null;
let shareRecipients = [];
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_IMAGE_DURATION_MS = 5000;
const storiesSeenKey = `story_seen_${username}`;
let stories = [];
let seenStoryIds = new Set();
let storyViewerQueue = [];
let storyViewerIndex = 0;
let storyTimer = null;
let storyTickTimer = null;
let viewedStoryIds = new Set();
let editPostModalState = null;

function setStoryUploadLoading(isLoading, text = "Uploading story... 0%", percent = 0) {
  if (storyUploadLoader) {
    storyUploadLoader.classList.toggle("show", !!isLoading);
    storyUploadLoader.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }
  if (storyUploadText) storyUploadText.textContent = text;
  if (storyUploadBar) storyUploadBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  if (storyMediaInput) storyMediaInput.disabled = !!isLoading;
}

function uploadStoryWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("media", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${STORIES_API}/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      if (typeof onProgress === "function") onProgress(percent);
    };

    xhr.onload = () => {
      const raw = String(xhr.responseText || "");
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (err) {
        data = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      reject(new Error(data.message || "Could not upload story."));
    };

    xhr.onerror = () => {
      reject(new Error("Network error during story upload."));
    };

    xhr.send(formData);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url, fallback = "") {
  const raw = String(url ?? "").trim();
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

function sameId(a, b) {
  return String(a) === String(b);
}

function getRoom(user1, user2) {
  return [String(user1 || ""), String(user2 || "")].sort().join("_");
}

function getShareUrl(postId) {
  const baseUrl = new URL("index.html", window.location.href);
  return `${baseUrl.origin}${baseUrl.pathname}#post-${encodeURIComponent(String(postId || ""))}`;
}

function getPostById(postId) {
  return allPosts.find((post) => sameId(post.id, postId)) || null;
}

async function copyPostLink(postId) {
  const link = getShareUrl(postId);
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(link);
    return link;
  }
  const input = document.createElement("input");
  input.value = link;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  return link;
}

async function submitPostReport(postId) {
  const post = getPostById(postId);
  if (!post) throw new Error("Post not found");
  if (String(post.authorUsername || "") === username) {
    throw new Error("You cannot report your own post");
  }
  const reason = window.prompt("Why are you reporting this post? (e.g. spam, abuse, hate, harassment)");
  if (reason === null) return false;
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("Report reason is required");

  const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
    ? window.APP_CONFIG.authFetch(`${REPORTS_API}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "post",
        targetId: String(post.id || ""),
        targetUsername: String(post.authorUsername || ""),
        reason: cleanReason
      })
    })
    : fetch(`${REPORTS_API}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        
      },
      body: JSON.stringify({
        targetType: "post",
        targetId: String(post.id || ""),
        targetUsername: String(post.authorUsername || ""),
        reason: cleanReason
      })
    }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not submit report");
  return true;
}

async function fetchBookmarkCollections() {
  const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
    ? window.APP_CONFIG.authFetch(`${USERS_API}/bookmarks/collections`)
    : fetch(`${USERS_API}/bookmarks/collections`, {
      headers: {}
    }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not load collections");
  return Array.isArray(data.items) ? data.items : [];
}

async function savePostToCollection(postId) {
  const collections = await fetchBookmarkCollections();
  if (!collections.length) {
    throw new Error("No collections. Create one in Settings.");
  }
  const options = collections.map((c) => String(c.name || "")).filter(Boolean);
  const picked = window.prompt(`Save to collection:\n${options.join(", ")}`, options[0] || "");
  if (picked === null) return false;
  const target = String(picked || "").trim();
  if (!target) return false;
  const exact = options.find((n) => n.toLowerCase() === target.toLowerCase()) || target;
  const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
    ? window.APP_CONFIG.authFetch(`${USERS_API}/bookmarks/collections/${encodeURIComponent(exact)}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId })
    })
    : fetch(`${USERS_API}/bookmarks/collections/${encodeURIComponent(exact)}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        
      },
      body: JSON.stringify({ postId })
    }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not save to collection");
  return true;
}

function ensureEditPostModal() {
  if (editPostModalState) return editPostModalState;

  const styleId = "editPostModalStyles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .edit-post-modal {
        position: fixed;
        inset: 0;
        z-index: 140;
        background: rgba(2, 10, 18, 0.72);
        backdrop-filter: blur(3px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      }
      .edit-post-modal.show {
        display: flex;
      }
      .edit-post-card {
        width: min(560px, 96vw);
        border: 1px solid rgba(153, 197, 244, 0.28);
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(12, 31, 54, 0.98), rgba(7, 21, 38, 0.95));
        box-shadow: 0 18px 34px rgba(0, 0, 0, 0.4);
        padding: 0.9rem;
      }
      .edit-post-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.7rem;
      }
      .edit-post-head h3 {
        margin: 0;
        color: #eaf5ff;
        font-size: 1rem;
      }
      .edit-post-close {
        border: 1px solid rgba(157, 199, 241, 0.28);
        border-radius: 8px;
        background: rgba(58, 87, 118, 0.28);
        color: #def1ff;
        padding: 0.2rem 0.5rem;
        cursor: pointer;
      }
      .edit-post-label {
        display: block;
        margin: 0.35rem 0;
        color: #d8ecff;
        font-size: 0.85rem;
      }
      .edit-post-caption,
      .edit-post-privacy {
        width: 100%;
        border: 1px solid rgba(157, 199, 241, 0.26);
        border-radius: 10px;
        background: rgba(7, 20, 36, 0.86);
        color: #eaf5ff;
        font-size: 0.9rem;
        padding: 0.55rem 0.65rem;
      }
      .edit-post-caption {
        min-height: 110px;
        resize: vertical;
      }
      .edit-post-actions {
        margin-top: 0.8rem;
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
      }
      .edit-post-btn {
        border-radius: 999px;
        border: 1px solid rgba(157, 199, 241, 0.25);
        color: #eaf5ff;
        background: rgba(55, 96, 132, 0.3);
        font-size: 0.82rem;
        padding: 0.34rem 0.78rem;
        cursor: pointer;
      }
      .edit-post-btn.primary {
        border: 0;
        color: #03263f;
        font-weight: 700;
        background: linear-gradient(120deg, #31c0ff, #46e0b6);
      }
    `;
    document.head.appendChild(style);
  }

  const modal = document.createElement("div");
  modal.className = "edit-post-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="edit-post-card" role="dialog" aria-modal="true" aria-label="Edit post">
      <div class="edit-post-head">
        <h3>Edit Post</h3>
        <button type="button" class="edit-post-close" aria-label="Close">x</button>
      </div>
      <label class="edit-post-label" for="editPostCaptionInput">Caption</label>
      <textarea id="editPostCaptionInput" class="edit-post-caption" maxlength="500"></textarea>
      <label class="edit-post-label" for="editPostPrivacyInput">Privacy</label>
      <select id="editPostPrivacyInput" class="edit-post-privacy">
        <option value="public">Public</option>
        <option value="followers">Followers</option>
        <option value="private">Private</option>
      </select>
      <div class="edit-post-actions">
        <button type="button" class="edit-post-btn" data-edit-cancel>Cancel</button>
        <button type="button" class="edit-post-btn primary" data-edit-save>Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const captionInput = modal.querySelector("#editPostCaptionInput");
  const privacyInput = modal.querySelector("#editPostPrivacyInput");
  const closeBtn = modal.querySelector(".edit-post-close");
  const cancelBtn = modal.querySelector("[data-edit-cancel]");
  const saveBtn = modal.querySelector("[data-edit-save]");
  let resolver = null;

  function close(result = null) {
    if (resolver) {
      const resolveFn = resolver;
      resolver = null;
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
      resolveFn(result);
    } else {
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  closeBtn.addEventListener("click", () => close(null));
  cancelBtn.addEventListener("click", () => close(null));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close(null);
  });
  document.addEventListener("keydown", (event) => {
    if (!modal.classList.contains("show")) return;
    if (event.key === "Escape") close(null);
  });
  saveBtn.addEventListener("click", () => {
    const caption = String(captionInput.value || "").trim();
    const privacy = String(privacyInput.value || "").trim();
    if (!["public", "followers", "private"].includes(privacy)) return;
    close({ caption, privacy });
  });

  editPostModalState = {
    open(initialCaption = "", initialPrivacy = "public") {
      captionInput.value = String(initialCaption || "");
      privacyInput.value = ["public", "followers", "private"].includes(String(initialPrivacy))
        ? String(initialPrivacy)
        : "public";
      modal.classList.add("show");
      modal.setAttribute("aria-hidden", "false");
      setTimeout(() => {
        captionInput.focus();
        captionInput.selectionStart = captionInput.value.length;
        captionInput.selectionEnd = captionInput.value.length;
      }, 10);
      return new Promise((resolve) => {
        resolver = resolve;
      });
    }
  };

  return editPostModalState;
}

async function editPostFlow(postId) {
  const post = getPostById(postId);
  if (!post) throw new Error("Post not found");
  if (String(post.authorUsername || "") !== username) {
    throw new Error("You can edit only your own post");
  }

  const modal = ensureEditPostModal();
  const result = await modal.open(String(post.caption || ""), String(post.privacy || "public"));
  if (!result) return false;
  const normalizedPrivacy = String(result.privacy || "").trim().toLowerCase();
  const normalizedCaption = String(result.caption || "").trim();

  const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
    ? window.APP_CONFIG.authFetch(`${API_BASE}/${encodeURIComponent(String(postId))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caption: normalizedCaption,
        privacy: normalizedPrivacy
      })
    })
    : fetch(`${API_BASE}/${encodeURIComponent(String(postId))}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        
      },
      body: JSON.stringify({
        caption: normalizedCaption,
        privacy: normalizedPrivacy
      })
    }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not edit post");

  if (data.post) {
    allPosts = allPosts.map((item) => (sameId(item.id, postId) ? data.post : item));
    applyFiltersStable();
  }
  return true;
}

function getTargetPostIdFromHash() {
  const match = String(window.location.hash || "").match(/^#post-(.+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1] || "");
  } catch (err) {
    return match[1] || "";
  }
}

function focusPostFromHash() {
  const targetId = getTargetPostIdFromHash();
  if (!targetId) return;
  const el = document.getElementById(`post-${String(targetId)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const previousShadow = el.style.boxShadow;
  const previousOutline = el.style.outline;
  el.style.boxShadow = "0 0 0 2px rgba(88, 189, 255, 0.9)";
  el.style.outline = "1px solid rgba(88, 189, 255, 0.7)";
  setTimeout(() => {
    el.style.boxShadow = previousShadow;
    el.style.outline = previousOutline;
  }, 1400);
}

function buildPostShareMessage(postId) {
  const post = getPostById(postId);
  if (!post) return null;
  const payload = {
    type: "post_share",
    postId: String(post.id),
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
        name: String(raw.name || raw.username || raw || uname),
        avatarUrl: sanitizeUrl(raw.avatarUrl, "assets/default-avatar.svg")
      });
    }
  };

  (relations.followers || []).forEach(addUser);
  (relations.following || []).forEach(addUser);

  try {
    const knownRaw = localStorage.getItem("known_users");
    const known = knownRaw ? JSON.parse(knownRaw) : [];
    if (Array.isArray(known)) known.forEach((uname) => addUser({ username: uname, name: uname }));
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
    shareUserList.innerHTML = '<p class="muted-line">No users found.</p>';
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
  if (!shareModal) return;
  sharePostId = String(postId || "");
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
  sharePostId = null;
}

function isDeletedUserError(payload) {
  const text = String((payload && payload.error) || (payload && payload.message) || "").toLowerCase();
  return text.includes("user not found") || text.includes("users not found");
}

function removeDeletedShareRecipient(targetUsername) {
  const target = String(targetUsername || "").trim();
  if (!target) return;
  shareRecipients = (Array.isArray(shareRecipients) ? shareRecipients : []).filter((u) => String((u && u.username) || "") !== target);
  try {
    const raw = localStorage.getItem("known_users");
    const users = raw ? JSON.parse(raw) : [];
    const next = (Array.isArray(users) ? users : []).filter((u) => String(u || "") !== target);
    localStorage.setItem("known_users", JSON.stringify(next));
  } catch (err) {}
  renderShareRecipients(shareSearchInput ? shareSearchInput.value : "");
}

async function sendPostToUser(targetUsername, triggerBtn = null) {
  if (!targetUsername || !sharePostId) return;
  const room = getRoom(username, targetUsername);
  const shareMessage = buildPostShareMessage(sharePostId);
  if (!shareMessage) {
    uploadStatus.textContent = "Could not find this post to share.";
    return;
  }
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "Sending...";
  }
  try {
    socket.emit("joinRoom", room);
    const ack = await new Promise((resolve) => {
      socket.emit("sendMessage", {
        sender: username,
        receiver: targetUsername,
        message: shareMessage,
        room,
        isFile: false
      }, resolve);
    });
    if (!(ack && ack.ok)) {
      if (isDeletedUserError(ack)) {
        removeDeletedShareRecipient(targetUsername);
      }
      throw new Error((ack && ack.error) || "Could not send post in chat.");
    }
    await trackPostShare(sharePostId);
    uploadStatus.textContent = `Post sent to @${targetUsername}.`;
    if (triggerBtn) triggerBtn.textContent = "Sent";
  } catch (err) {
    uploadStatus.textContent = String(err && err.message ? err.message : "Could not send post in chat.");
    if (triggerBtn) triggerBtn.textContent = "Retry";
  } finally {
    if (triggerBtn) {
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.textContent = "Send";
      }, 1200);
    }
  }
}

async function trackPostShare(postId) {
  const id = String(postId || "").trim();
  if (!id) return;
  try {
    await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/${encodeURIComponent(id)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      : fetch(`${API_BASE}/${encodeURIComponent(id)}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify({})
      }));
  } catch (err) {
    // no-op: share tracking should not block UX
  }
}

function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function timeAgo(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.max(1, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function cleanupExpiredStories() {
  const now = Date.now();
  stories = stories.filter((story) => {
    const createdAtMs = new Date(story.createdAt || 0).getTime();
    return Number.isFinite(createdAtMs) && now - createdAtMs < STORY_TTL_MS;
  });
}

async function loadStories() {
  try {
    const rawSeen = localStorage.getItem(storiesSeenKey);
    const parsedSeen = rawSeen ? JSON.parse(rawSeen) : [];
    seenStoryIds = new Set(Array.isArray(parsedSeen) ? parsedSeen.map((id) => String(id)) : []);
  } catch (err) {
    seenStoryIds = new Set();
  }

  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${STORIES_API}?limit=240`)
      : fetch(`${STORIES_API}?limit=240`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load stories");
    stories = Array.isArray(data) ? data : [];
    cleanupExpiredStories();
    renderStoriesRail();
  } catch (err) {
    stories = [];
    renderStoriesRail();
  }
}

function persistSeenStories() {
  localStorage.setItem(storiesSeenKey, JSON.stringify(Array.from(seenStoryIds)));
}

function getStoryAuthorMap() {
  const map = new Map();
  const sorted = [...stories].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  sorted.forEach((story) => {
    const key = String(story.authorUsername || "");
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(story);
  });
  return map;
}

function renderStoriesRail() {
  if (!storiesRail) return;
  cleanupExpiredStories();

  const authorMap = getStoryAuthorMap();
  const myStories = authorMap.get(username) || [];
  const myLatest = myStories[myStories.length - 1] || null;
  const allByLatest = Array.from(authorMap.values())
    .map((items) => items[items.length - 1])
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const otherLatest = allByLatest.filter((story) => String(story.authorUsername) !== username);

  let myProfile = {};
  try {
    myProfile = JSON.parse(localStorage.getItem(`profile_${username}`) || "{}") || {};
  } catch (err) {
    myProfile = {};
  }
  const myAvatar = sanitizeUrl(myProfile.avatarUrl, "assets/default-avatar.svg");

  const myCard = `
    <button type="button" class="story-card${myLatest && seenStoryIds.has(String(myLatest.id)) ? " is-seen" : ""}" data-open-story-author="${escapeHtml(username)}">
      <div class="story-ring">
        <div class="story-ring-inner">
          <div class="story-avatar-wrap">
            <img class="story-avatar" src="${escapeHtml(myAvatar)}" alt="Your story">
            <span class="story-plus" data-story-add="1">+</span>
          </div>
        </div>
      </div>
      <span class="story-label">${myStories.length ? "Your Story" : "Add Story"}</span>
    </button>
  `;

  const others = otherLatest.map((story) => {
    const author = String(story.authorUsername || "");
    const authorStories = authorMap.get(author) || [];
    const hasUnseen = authorStories.some((s) => !seenStoryIds.has(String(s.id)));
    return `
      <button type="button" class="story-card${hasUnseen ? "" : " is-seen"}" data-open-story-author="${escapeHtml(author)}">
        <div class="story-ring">
          <div class="story-ring-inner">
            <img class="story-avatar" src="${escapeHtml(sanitizeUrl(story.authorAvatarUrl, "assets/default-avatar.svg"))}" alt="${escapeHtml(author)} story">
          </div>
        </div>
        <span class="story-label">${escapeHtml(story.authorDisplayName || author)}</span>
      </button>
    `;
  }).join("");

  storiesRail.innerHTML = myCard + others;
}

function clearStoryTimers() {
  if (storyTimer) {
    clearTimeout(storyTimer);
    storyTimer = null;
  }
  if (storyTickTimer) {
    clearInterval(storyTickTimer);
    storyTickTimer = null;
  }
}

function buildStoryQueue(startAuthor = "", startStoryId = "") {
  const authorMap = getStoryAuthorMap();
  let queue = [];
  if (startAuthor && authorMap.has(startAuthor)) {
    queue = (authorMap.get(startAuthor) || [])
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else {
    const authors = Array.from(authorMap.keys()).sort((a, b) => {
      const aLatest = authorMap.get(a).slice(-1)[0];
      const bLatest = authorMap.get(b).slice(-1)[0];
      return new Date(bLatest.createdAt) - new Date(aLatest.createdAt);
    });
    authors.forEach((author) => {
      const items = (authorMap.get(author) || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      items.forEach((item) => queue.push(item));
    });
  }

  if (!queue.length) return [];
  if (!startStoryId) return queue;
  const idx = queue.findIndex((story) => sameId(story.id, startStoryId));
  if (idx < 0) return queue;
  return queue.slice(idx).concat(queue.slice(0, idx));
}

function closeStoryViewer() {
  if (!storyViewerModal) return;
  clearStoryTimers();
  storyViewerModal.classList.remove("show");
  storyViewerModal.setAttribute("aria-hidden", "true");
  storyViewerQueue = [];
  storyViewerIndex = 0;
  if (storyViewerMediaWrap) storyViewerMediaWrap.innerHTML = "";
  if (storyProgress) storyProgress.innerHTML = "";
  if (storyReplyInput) storyReplyInput.value = "";
  if (storyInteractionsPanel) {
    storyInteractionsPanel.classList.remove("show");
    storyInteractionsPanel.innerHTML = "";
  }
}

function setStoryProgress(activePercent = 0) {
  if (!storyProgress) return;
  const bars = Array.from(storyProgress.querySelectorAll("[data-story-progress]"));
  bars.forEach((bar, index) => {
    if (index < storyViewerIndex) bar.style.width = "100%";
    else if (index > storyViewerIndex) bar.style.width = "0%";
    else bar.style.width = `${Math.max(0, Math.min(100, activePercent))}%`;
  });
}

function getActiveStory() {
  if (!storyViewerQueue.length) return null;
  return storyViewerQueue[storyViewerIndex] || null;
}

function syncStoryReactionButtons(story) {
  if (!storyReactionsBar) return;
  const myEmoji = story && story.myReaction ? String(story.myReaction.emoji || "") : "";
  Array.from(storyReactionsBar.querySelectorAll("[data-story-react]")).forEach((btn) => {
    const emoji = String(btn.getAttribute("data-story-react") || "");
    btn.classList.toggle("is-active", !!myEmoji && myEmoji === emoji);
  });
}

async function markStoryViewed(story) {
  if (!story || !story.id) return;
  const storyId = String(story.id);
  if (viewedStoryIds.has(storyId)) return;
  viewedStoryIds.add(storyId);

  try {
    await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${STORIES_API}/${encodeURIComponent(storyId)}/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        })
      : fetch(`${STORIES_API}/${encodeURIComponent(storyId)}/view`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            
          },
          body: JSON.stringify({})
        }));
  } catch (err) {
    // ignore background tracking errors
  }
}

function renderStoryInteractionsPanel(data) {
  if (!storyInteractionsPanel) return;
  if (!data) {
    storyInteractionsPanel.innerHTML = "";
    storyInteractionsPanel.classList.remove("show");
    return;
  }

  const summary = Array.isArray(data.reactionSummary) ? data.reactionSummary : [];
  const topViews = Array.isArray(data.views) ? data.views.slice(0, 8) : [];
  const topReplies = Array.isArray(data.replies) ? data.replies.slice(0, 8) : [];

  const summaryText = summary.length
    ? summary.map((entry) => `${escapeHtml(entry.emoji)} ${entry.count}`).join("  ")
    : "No reactions yet";

  const viewsText = topViews.length
    ? topViews.map((entry) => `@${escapeHtml(entry.username)} (${timeAgo(entry.viewedAt)})`).join("<br>")
    : "No viewers yet";

  const repliesText = topReplies.length
    ? topReplies.map((entry) => `@${escapeHtml(entry.fromUsername)}: ${escapeHtml(entry.text)}`).join("<br>")
    : "No replies yet";

  storyInteractionsPanel.innerHTML = `
    <div><strong>Views:</strong> ${Number(data.viewsCount || 0)}</div>
    <div style="margin-top:0.22rem;"><strong>Reactions:</strong> ${summaryText}</div>
    <div style="margin-top:0.32rem;"><strong>Recent viewers</strong><br>${viewsText}</div>
    <div style="margin-top:0.32rem;"><strong>Recent replies</strong><br>${repliesText}</div>
  `;
  storyInteractionsPanel.classList.add("show");
}

async function loadOwnerStoryInteractions(story) {
  if (!story || !story.id || !storyInteractionsPanel) return;
  storyInteractionsPanel.textContent = "Loading interactions...";
  storyInteractionsPanel.classList.add("show");
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${STORIES_API}/${encodeURIComponent(String(story.id))}/interactions`)
      : fetch(`${STORIES_API}/${encodeURIComponent(String(story.id))}/interactions`, {
          headers: {}
        }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not load interactions");
    renderStoryInteractionsPanel(data);
  } catch (err) {
    storyInteractionsPanel.textContent = err.message || "Could not load interactions.";
    storyInteractionsPanel.classList.add("show");
  }
}

async function reactToActiveStory(emoji) {
  const story = getActiveStory();
  if (!story || !story.id || !emoji) return;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${STORIES_API}/${encodeURIComponent(String(story.id))}/react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji })
        })
      : fetch(`${STORIES_API}/${encodeURIComponent(String(story.id))}/react`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            
          },
          body: JSON.stringify({ emoji })
        }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not react to story");

    story.myReaction = { emoji, reactedAt: new Date().toISOString() };
    story.reactionSummary = Array.isArray(data.reactionSummary) ? data.reactionSummary : (story.reactionSummary || []);
    syncStoryReactionButtons(story);
    uploadStatus.textContent = "Reaction sent.";
  } catch (err) {
    uploadStatus.textContent = err.message || "Could not react to story.";
  }
}

async function replyToActiveStory(text) {
  const story = getActiveStory();
  const bodyText = String(text || "").trim();
  if (!story || !story.id || !bodyText) return;
  if (storyReplySendBtn) storyReplySendBtn.disabled = true;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${STORIES_API}/${encodeURIComponent(String(story.id))}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: bodyText })
        })
      : fetch(`${STORIES_API}/${encodeURIComponent(String(story.id))}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            
          },
          body: JSON.stringify({ text: bodyText })
        }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not send reply");

    if (storyReplyInput) storyReplyInput.value = "";
    story.repliesCount = Number(data.repliesCount || (Number(story.repliesCount || 0) + 1));
    uploadStatus.textContent = "Reply sent.";
  } catch (err) {
    uploadStatus.textContent = err.message || "Could not send reply.";
  } finally {
    if (storyReplySendBtn) storyReplySendBtn.disabled = false;
  }
}

function openStoryAt(index) {
  if (!storyViewerModal || !storyViewerMediaWrap) return;
  if (!storyViewerQueue.length) {
    closeStoryViewer();
    return;
  }

  if (index < 0) index = 0;
  if (index >= storyViewerQueue.length) {
    closeStoryViewer();
    return;
  }

  clearStoryTimers();
  storyViewerIndex = index;
  const story = storyViewerQueue[storyViewerIndex];
  if (!story) {
    closeStoryViewer();
    return;
  }
  markStoryViewed(story);

  seenStoryIds.add(String(story.id));
  persistSeenStories();
  renderStoriesRail();

  if (storyViewerAvatar) {
    storyViewerAvatar.src = sanitizeUrl(story.authorAvatarUrl, "assets/default-avatar.svg");
  }
  if (storyViewerName) {
    storyViewerName.textContent = story.authorDisplayName || story.authorUsername || "Story";
  }
  if (storyViewerTime) {
    storyViewerTime.textContent = timeAgo(story.createdAt);
  }
  if (deleteStoryBtn) {
    const canDelete = String(story.authorUsername || "") === username;
    deleteStoryBtn.classList.toggle("show", canDelete);
    deleteStoryBtn.disabled = false;
    deleteStoryBtn.setAttribute("data-story-id", canDelete ? String(story.id || "") : "");
    if (storyInteractionsBtn) {
      storyInteractionsBtn.style.display = canDelete ? "inline-flex" : "none";
    }
    if (storyInteractionsPanel) {
      storyInteractionsPanel.classList.remove("show");
      storyInteractionsPanel.innerHTML = "";
    }
  }
  syncStoryReactionButtons(story);

  const safeUrl = sanitizeUrl(story.mediaUrl, "");
  storyViewerMediaWrap.innerHTML = "";

  if (story.mediaType === "video") {
    const video = document.createElement("video");
    video.className = "story-viewer-media";
    video.src = safeUrl;
    video.autoplay = false;
    video.muted = false;
    video.playsInline = true;
    video.controls = false;
    storyViewerMediaWrap.appendChild(video);

    let timerStarted = false;
    const startTimerForVideo = () => {
      if (timerStarted) return;
      timerStarted = true;
      const durationMs = Math.max(1200, Number.isFinite(video.duration) ? video.duration * 1000 : 6000);
      const startedAt = Date.now();
      setStoryProgress(0);
      storyTickTimer = setInterval(() => {
        const pct = ((Date.now() - startedAt) / durationMs) * 100;
        setStoryProgress(pct);
      }, 80);
      storyTimer = setTimeout(() => {
        openStoryAt(storyViewerIndex + 1);
      }, durationMs);
    };

    video.addEventListener("ended", () => openStoryAt(storyViewerIndex + 1), { once: true });

    const startVideoOnIntent = () => {
      startTimerForVideo();
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          startTimerForVideo();
        });
      }
    };

    video.addEventListener("mouseenter", startVideoOnIntent, { once: true });
    video.addEventListener("focusin", startVideoOnIntent, { once: true });
    video.addEventListener("touchstart", startVideoOnIntent, { once: true, passive: true });
  } else {
    const img = document.createElement("img");
    img.className = "story-viewer-media";
    img.src = safeUrl;
    img.alt = "Story";
    storyViewerMediaWrap.appendChild(img);

    const startedAt = Date.now();
    setStoryProgress(0);
    storyTickTimer = setInterval(() => {
      const pct = ((Date.now() - startedAt) / STORY_IMAGE_DURATION_MS) * 100;
      setStoryProgress(pct);
    }, 80);
    storyTimer = setTimeout(() => {
      openStoryAt(storyViewerIndex + 1);
    }, STORY_IMAGE_DURATION_MS);
  }
}

async function deleteCurrentStory(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!deleteStoryBtn) return;
  const storyId = String(deleteStoryBtn.getAttribute("data-story-id") || "");
  if (!storyId) return;
  if (!(await uiConfirm("Delete this story?", { tone: "danger", okText: "Delete" }))) return;

  deleteStoryBtn.disabled = true;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${STORIES_API}/${encodeURIComponent(storyId)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        })
      : fetch(`${STORIES_API}/${encodeURIComponent(storyId)}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            
          },
          body: JSON.stringify({})
        }));
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (err) {
      data = {};
    }
    if (!res.ok) throw new Error(data.message || "Could not delete story.");

    stories = stories.filter((story) => !sameId(story.id, storyId));
    storyViewerQueue = storyViewerQueue.filter((story) => !sameId(story.id, storyId));
    seenStoryIds.delete(storyId);
    persistSeenStories();
    renderStoriesRail();
    uploadStatus.textContent = "Story deleted.";

    if (!storyViewerQueue.length) {
      closeStoryViewer();
      return;
    }
    const nextIndex = Math.min(storyViewerIndex, storyViewerQueue.length - 1);
    openStoryAt(nextIndex);
  } catch (err) {
    uploadStatus.textContent = err.message || "Could not delete story.";
    deleteStoryBtn.disabled = false;
  }
}

function openStoryViewer(startAuthor, startStoryId = "") {
  if (!storyViewerModal) return;
  cleanupExpiredStories();
  viewedStoryIds = new Set();
  storyViewerQueue = buildStoryQueue(startAuthor, startStoryId);
  if (!storyViewerQueue.length) {
    uploadStatus.textContent = "No active stories yet.";
    return;
  }

  storyViewerIndex = 0;
  storyViewerModal.classList.add("show");
  storyViewerModal.setAttribute("aria-hidden", "false");

  if (storyProgress) {
    storyProgress.innerHTML = storyViewerQueue.map(() => (
      '<div class="story-progress-item"><span data-story-progress></span></div>'
    )).join("");
  }

  openStoryAt(0);
}

async function createStoryFromFile(file) {
  if (!file) return;
  const mime = String(file.type || "").toLowerCase();
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  if (!isImage && !isVideo) {
    uploadStatus.textContent = "Stories only support image or video files.";
    return;
  }

  setStoryUploadLoading(true, "Uploading story... 0%", 0);
  try {
    const data = await uploadStoryWithProgress(file, (percent) => {
      setStoryUploadLoading(true, `Uploading story... ${percent}%`, percent);
    });

    if (data && data.story) {
      stories = [data.story, ...stories];
      cleanupExpiredStories();
    } else {
      await loadStories();
    }

    setStoryUploadLoading(true, "Uploading story... 100%", 100);
    renderStoriesRail();
    uploadStatus.textContent = "Story uploaded.";
    openStoryViewer(username, data && data.story ? data.story.id : "");
  } catch (err) {
    uploadStatus.textContent = err.message || "Could not upload story.";
  } finally {
    setTimeout(() => {
      setStoryUploadLoading(false, "Uploading story... 0%", 0);
    }, 250);
  }
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

function renderRelationsList(container, users) {
  if (!container) return;
  if (!Array.isArray(users) || users.length === 0) {
    container.innerHTML = '<p class="muted-line">No users yet.</p>';
    return;
  }

  container.innerHTML = users.map((u) => {
    const uname = escapeHtml(u.username || "");
    const display = escapeHtml(u.name || u.username || "user");
    const avatar = sanitizeUrl(u.avatarUrl, "assets/default-avatar.svg");
    const online = onlineUsersSet.has(u.username);
    return `
      <div class="relation-item" data-user-filter="${uname}">
        <div class="relation-left">
          <img class="relation-avatar" src="${avatar}" alt="${uname}" onerror="this.src='assets/default-avatar.svg'">
          <span class="relation-name">${display}</span>
        </div>
        <span class="status-pill ${online ? "online" : ""}">${online ? "online" : "offline"}</span>
      </div>
    `;
  }).join("");
}

function renderRelations() {
  renderRelationsList(followersList, relations.followers);
  renderRelationsList(followingList, relations.following);
}

async function loadRelations() {
  if (!username) {
    relations = { followers: [], following: [] };
    renderRelations();
    return;
  }
  try {
    const res = await fetch(`${USERS_API}/profile/${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!res.ok) return;
    relations = {
      followers: Array.isArray(data.followers) ? data.followers : [],
      following: Array.isArray(data.following) ? data.following : []
    };
    renderRelations();
  } catch (err) {}
}

function getTypeFilteredPosts(posts) {
  if (activeTypeFilter === "mine") return posts.filter((post) => post.authorUsername === username);
  if (activeTypeFilter === "image") return posts.filter((post) => post.mediaType === "image");
  if (activeTypeFilter === "video") return posts.filter((post) => post.mediaType === "video");
  if (activeTypeFilter === "saved") return posts.filter((post) => savedPostIds.has(String(post.id)));
  return posts;
}

async function loadSavedPosts() {
  if (!username) {
    savedPostIds = new Set();
    applyFilters();
    return;
  }
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/saved`)
      : fetch(`${API_BASE}/saved`));
    if (res.ok) {
      const posts = await res.json();
      const ids = Array.isArray(posts) ? posts.map((p) => String(p.id)) : [];
      savedPostIds = new Set(ids);
      localStorage.setItem(savedPostsKey, JSON.stringify(ids));
      applyFilters();
      return;
    }
  } catch (err) {
    // fallback to local cache below
  }

  try {
    const raw = localStorage.getItem(savedPostsKey);
    const arr = raw ? JSON.parse(raw) : [];
    savedPostIds = new Set(Array.isArray(arr) ? arr.map((id) => String(id)) : []);
    applyFilters();
  } catch (err) {
    savedPostIds = new Set();
  }
}

function persistSavedPosts() {
  localStorage.setItem(savedPostsKey, JSON.stringify(Array.from(savedPostIds)));
}

function getSortedPosts(posts) {
  const list = [...posts];
  if (activeSort === "liked") {
    list.sort((a, b) => (Number(b.likesCount || 0) - Number(a.likesCount || 0)));
    return list;
  }
  if (activeSort === "commented") {
    const commentsLen = (p) => (Array.isArray(p.comments) ? p.comments.length : 0);
    list.sort((a, b) => (commentsLen(b) - commentsLen(a)));
    return list;
  }
  list.sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  return list;
}

function prioritizeTargetPost(posts) {
  const targetId = getTargetPostIdFromHash();
  if (!targetId) return posts;
  const idx = posts.findIndex((post) => sameId(post.id, targetId));
  if (idx <= 0) return posts;
  const reordered = [...posts];
  const [target] = reordered.splice(idx, 1);
  reordered.unshift(target);
  return reordered;
}

function updateCommentSendButtonState(form) {
  if (!form) return;
  const input = form.querySelector('input[name="comment"]');
  const submitBtn = form.querySelector("button[type='submit']");
  if (!input || !submitBtn) return;
  const hasText = (input.value || "").trim().length > 0;
  submitBtn.disabled = !hasText;
  submitBtn.classList.toggle("is-active", hasText);
}

function syncCommentSendButtons(root = feed) {
  if (!root) return;
  root.querySelectorAll("[data-comment-form]").forEach((form) => {
    if (form.dataset.sendBound !== "1") {
      const input = form.querySelector('input[name="comment"]');
      if (input) {
        input.addEventListener("input", () => updateCommentSendButtonState(form));
      }
      form.dataset.sendBound = "1";
    }
    updateCommentSendButtonState(form);
  });
}

function renderPosts(posts) {
  if (!posts.length) {
    feed.innerHTML = '<p class="post-time">No matching users/posts found.</p>';
    return;
  }

  feed.innerHTML = posts.map((post) => {
    const postId = String(post.id);
    const avatar = sanitizeUrl(post.authorAvatarUrl, "assets/default-avatar.svg");
    const authorUsername = escapeHtml(post.authorUsername || "user");
    const compactDisplay = (post.authorDisplayName || post.authorUsername || "User");
    const authorDisplayName = escapeHtml(compactDisplay);
    const verifiedBadge = post.authorVerified
      ? '<i class="bi bi-patch-check-fill" title="Verified" style="color:#6fd3ff;margin-left:0.25rem;font-size:0.78rem;"></i>'
      : "";
    const privacyValue = String(post.privacy || "public");
    const privacyLabel = privacyValue === "private"
      ? "Only me"
      : (privacyValue === "followers" ? "Followers" : "Public");
    const privacyIcon = privacyValue === "private"
      ? "bi-lock-fill"
      : (privacyValue === "followers" ? "bi-people-fill" : "bi-globe2");
    const likedByMe = Array.isArray(post.likedBy) && post.likedBy.includes(username);
    const isSaved = savedPostIds.has(postId);
    const likesCount = post.likesCount || 0;
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const isCommentsPanelOpen = commentsPanelOpen.has(postId);
    const isExpanded = commentsExpanded.has(postId);
    const commentsHtml = renderCommentsHtml(post.id);

    const commentToggle = comments.length > 2
      ? `<button type="button" class="btn-toggle-comments" data-toggle-comments="${escapeHtml(post.id)}">${isExpanded ? "Hide comments" : `View all ${comments.length} comments`}</button>`
      : "";

    const safeMediaUrl = sanitizeUrl(post.mediaUrl, "");
    const media = post.mediaType === "video"
      ? `
          <div class="video-player" data-video-player>
            <video class="post-media" src="${safeMediaUrl}" preload="metadata" playsinline loop></video>
          </div>
        `
      : `<img class="post-media" src="${safeMediaUrl}" alt="Post by ${authorUsername}">`;

    return `
      <article class="post-card ${isCommentsPanelOpen ? "comments-open" : ""}" id="post-${escapeHtml(post.id)}">
        <div class="post-head">
          <div class="post-user">
            <img class="post-avatar" src="${avatar}" alt="${authorUsername} avatar" onerror="this.src='assets/default-avatar.svg'">
            <div>
              <strong>${authorDisplayName}${verifiedBadge}</strong>
            </div>
          </div>
          <div class="post-head-right">
            <span class="post-time"><i class="bi ${privacyIcon}"></i> ${privacyLabel}</span>
            <button type="button" class="post-menu-btn" data-menu-toggle="${escapeHtml(post.id)}" aria-label="Post options">
              <i class="bi bi-three-dots"></i>
            </button>
            <div class="post-menu" id="post-menu-${escapeHtml(post.id)}">
              <button type="button" class="post-menu-item ${isSaved ? "active" : ""}" data-save-post="${escapeHtml(post.id)}">${isSaved ? "Unsave" : "Save"}</button>
              <button type="button" class="post-menu-item" data-save-collection="${escapeHtml(post.id)}">Save to collection</button>
              <button type="button" class="post-menu-item" data-copy-link="${escapeHtml(post.id)}">Copy link</button>
              ${
                post.authorUsername !== username
                  ? `<button type="button" class="post-menu-item" data-report-post="${escapeHtml(post.id)}">Report post</button>`
                  : ""
              }
              ${
                post.authorUsername === username
                  ? `
                    <button type="button" class="post-menu-item" data-edit-post="${escapeHtml(post.id)}">Edit post</button>
                    <button type="button" class="post-menu-item danger" data-delete-post="${escapeHtml(post.id)}">Delete post</button>
                  `
                  : ""
              }
            </div>
          </div>
        </div>
        ${media}
        <div class="post-actions">
          <div class="post-actions-left">
            <button type="button" class="post-action-btn action-like ${likedByMe ? "active" : ""}" data-like-post="${escapeHtml(post.id)}" aria-label="Like post">
              <i class="bi ${likedByMe ? "bi-heart-fill" : "bi-heart"}"></i><span>Like</span>
            </button>
            <button type="button" class="post-action-btn action-comment" data-focus-comment="${escapeHtml(post.id)}" aria-label="Comment on post">
              <i class="bi bi-chat"></i><span>Comment</span>
            </button>
            <button type="button" class="post-action-btn action-share" data-share-post="${escapeHtml(post.id)}" aria-label="Share post">
              <i class="bi bi-send"></i><span>Share</span>
            </button>
          </div>
          <div class="post-actions-right">
            <button type="button" class="post-action-btn action-save ${isSaved ? "active" : ""}" data-save-post="${escapeHtml(post.id)}" aria-label="Save post">
              <i class="bi ${isSaved ? "bi-bookmark-fill" : "bi-bookmark"}"></i><span>${isSaved ? "Saved" : "Save"}</span>
            </button>
          </div>
        </div>
        <div class="post-meta-row">
          <span class="post-stats">${likesCount} likes - ${comments.length} comments</span>
        </div>
        <div class="post-comments-panel">
          ${commentToggle}
          <form class="comment-form" id="comment-form-${escapeHtml(post.id)}" data-comment-form="${escapeHtml(post.id)}">
            <input class="form-control" name="comment" maxlength="400" placeholder="Write a comment and press send..." required>
            <button class="btn-comment" type="submit" aria-label="Send comment" disabled><i class="bi bi-send-fill"></i></button>
          </form>
          <div class="comments-list">
            ${commentsHtml}
          </div>
        </div>
      </article>
    `;
  }).join("");

  initVideoPlayers();
  syncCommentSendButtons();
}

function findByData(root, attr, value) {
  if (!root) return null;
  return Array.from(root.querySelectorAll(`[${attr}]`))
    .find((el) => String(el.getAttribute(attr)) === String(value)) || null;
}

function renderCommentsHtml(postId) {
  const post = getPostById(postId);
  const comments = Array.isArray(post?.comments) ? post.comments : [];
  const isExpanded = commentsExpanded.has(String(postId));
  const shownComments = isExpanded ? comments : comments.slice(-1);
  if (!shownComments.length) return '<p class="post-time">No comments yet.</p>';

  const renderReplyRows = (comment) => {
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    if (!replies.length) return "";
    return `
      <div class="comment-replies" style="margin:0.32rem 0 0 0.7rem;border-left:1px solid rgba(153,197,244,0.24);padding-left:0.6rem;">
        ${replies.map((r) => `
          <div class="comment-item" style="margin-top:0.28rem;">
            <div class="comment-row">
              <div><strong>@${escapeHtml(r.username || "user")}</strong> ${escapeHtml(r.text || "")}<span>${timeAgo(r.createdAt)}</span></div>
              ${
                (r.username === username || comment.username === username || post.authorUsername === username)
                  ? `<button type="button" class="btn-delete" data-delete-reply="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(comment.id)}" data-reply-id="${escapeHtml(r.id)}">Delete</button>`
                  : ""
              }
            </div>
          </div>
        `).join("")}
      </div>
    `;
  };

  return shownComments.map((c) => `
    <div class="comment-item">
      <div class="comment-row">
        <div><strong>@${escapeHtml(c.username || "user")}</strong> ${escapeHtml(c.text || "")}<span>${timeAgo(c.createdAt)}</span></div>
        <div style="display:flex;gap:0.36rem;align-items:center;">
          <button type="button" class="btn-toggle-comments" style="padding:0.08rem 0.4rem;font-size:0.7rem;" data-toggle-reply-form="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}">Reply</button>
          ${
            (c.username === username || post.authorUsername === username)
              ? `<button type="button" class="btn-delete" data-delete-comment="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}">Delete</button>`
              : ""
          }
        </div>
      </div>
      ${
        replyFormsOpen.has(`${String(post.id)}::${String(c.id)}`)
          ? `
            <form class="comment-form" data-reply-form="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}" style="margin-top:0.34rem;">
              <input class="form-control" name="reply" maxlength="240" placeholder="Write a reply..." required>
              <button class="btn-comment" type="submit" aria-label="Send reply"><i class="bi bi-send-fill"></i></button>
            </form>
          `
          : ""
      }
      ${renderReplyRows(c)}
    </div>
  `).join("");
}

function updatePostCardUi(postId) {
  const post = getPostById(postId);
  const card = document.getElementById(`post-${String(postId)}`);
  if (!post || !card) return false;

  const postIdStr = String(postId);
  const likesCount = Number(post.likesCount || 0);
  const commentsCount = Array.isArray(post.comments) ? post.comments.length : 0;
  const likedByMe = Array.isArray(post.likedBy) && post.likedBy.includes(username);
  const isSaved = savedPostIds.has(postIdStr);

  const stats = card.querySelector(".post-stats");
  if (stats) stats.textContent = `${likesCount} likes - ${commentsCount} comments`;
  card.classList.toggle("comments-open", commentsPanelOpen.has(postIdStr));

  const likeBtn = findByData(card, "data-like-post", postIdStr);
  if (likeBtn) {
    likeBtn.classList.toggle("active", likedByMe);
    const icon = likeBtn.querySelector("i");
    if (icon) icon.className = `bi ${likedByMe ? "bi-heart-fill" : "bi-heart"}`;
  }

  const saveActionBtn = Array.from(card.querySelectorAll(".post-action-btn[data-save-post]"))
    .find((el) => String(el.getAttribute("data-save-post")) === postIdStr);
  if (saveActionBtn) {
    saveActionBtn.classList.toggle("active", isSaved);
    const icon = saveActionBtn.querySelector("i");
    const label = saveActionBtn.querySelector("span");
    if (icon) icon.className = `bi ${isSaved ? "bi-bookmark-fill" : "bi-bookmark"}`;
    if (label) label.textContent = isSaved ? "Saved" : "Save";
  }

  const menuSaveBtn = Array.from(card.querySelectorAll(".post-menu-item[data-save-post]"))
    .find((el) => String(el.getAttribute("data-save-post")) === postIdStr);
  if (menuSaveBtn) {
    menuSaveBtn.classList.toggle("active", isSaved);
    menuSaveBtn.textContent = isSaved ? "Unsave" : "Save";
  }

  const commentsPanel = card.querySelector(".post-comments-panel");
  if (commentsPanel) {
    let toggleBtn = findByData(commentsPanel, "data-toggle-comments", postIdStr);
    if (commentsCount > 2) {
      const text = commentsExpanded.has(postIdStr)
        ? "Hide comments"
        : `View all ${commentsCount} comments`;
      if (!toggleBtn) {
        toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "btn-toggle-comments";
        toggleBtn.setAttribute("data-toggle-comments", postIdStr);
        commentsPanel.prepend(toggleBtn);
      }
      toggleBtn.textContent = text;
    } else if (toggleBtn) {
      toggleBtn.remove();
    }
  }

  const commentsList = card.querySelector(".comments-list");
  if (commentsList) commentsList.innerHTML = renderCommentsHtml(postIdStr);

  return true;
}

function shouldFullRerender(action) {
  const query = (userSearchInput?.value || "").trim();
  if (query) return true;
  if (action === "like" && activeSort === "liked") return true;
  if (action === "comment" && activeSort === "commented") return true;
  if (action === "save" && activeTypeFilter === "saved") return true;
  return false;
}

function closeAllPostMenus() {
  feed.querySelectorAll(".post-menu.show").forEach((menu) => menu.classList.remove("show"));
}

function applyFilters() {
  const query = (userSearchInput.value || "").trim().toLowerCase();
  clearUserSearchBtn.classList.toggle("show", query.length > 0);
  const typed = getTypeFilteredPosts(allPosts);
  const sorted = prioritizeTargetPost(getSortedPosts(typed));

  if (!query) {
    renderPosts(sorted);
    focusPostFromHash();
    return;
  }

  const filtered = sorted.filter((post) => {
    const byUser = String(post.authorUsername || "").toLowerCase().includes(query);
    const byName = String(post.authorDisplayName || "").toLowerCase().includes(query);
    return byUser || byName;
  });
  renderPosts(filtered);
  focusPostFromHash();
}

function applyFiltersStable() {
  const previousY = window.scrollY;
  applyFilters();
  requestAnimationFrame(() => {
    window.scrollTo(0, previousY);
  });
}

function setTypeFilter(value) {
  activeTypeFilter = value;
  if (feedFilters) {
    Array.from(feedFilters.querySelectorAll("[data-type-filter]")).forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-type-filter") === value);
    });
  }
  applyFilters();
}

async function loadPosts() {
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}?limit=60`)
      : fetch(`${API_BASE}?limit=60`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load posts");
    allPosts = Array.isArray(data) ? data : [];
    applyFilters();
  } catch (err) {
    feed.innerHTML = `<p class="post-time">${escapeHtml(err.message || "Failed to load posts.")}</p>`;
  }
}

function uploadWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      loaderBar.style.width = `${percent}%`;
      loaderText.textContent = `Uploading... ${percent}%`;
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.message || "Upload failed"));
      } catch (err) {
        reject(new Error("Invalid server response"));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

if (postForm && mediaInput && uploadBtn && loaderWrap && loaderBar && loaderText && uploadStatus) {
  postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = mediaInput.files[0];
    if (!file) return;

    uploadBtn.disabled = true;
    loaderWrap.classList.add("show");
    loaderBar.style.width = "0%";
    loaderText.textContent = "Uploading... 0%";
    uploadStatus.textContent = "";

    const formData = new FormData();
    formData.append("username", username);
    formData.append("caption", captionInput ? (captionInput.value || "") : "");
    formData.append("privacy", (privacyInput && privacyInput.value) ? privacyInput.value : "public");
    formData.append("media", file);

    try {
      const data = await uploadWithProgress(formData);
      if (data && data.post) {
        allPosts = [data.post, ...allPosts];
        applyFilters();
      }
      uploadStatus.textContent = "Post uploaded successfully.";
      mediaInput.value = "";
      if (captionInput) captionInput.value = "";
      if (privacyInput) privacyInput.value = "public";
    } catch (err) {
      uploadStatus.textContent = err.message || "Upload failed.";
    } finally {
      uploadBtn.disabled = false;
      setTimeout(() => {
        loaderWrap.classList.remove("show");
        loaderBar.style.width = "0%";
      }, 700);
    }
  });
}

feed.addEventListener("click", async (event) => {
  const clickedButton = event.target.closest("button");
  if (clickedButton && clickedButton.type !== "submit") {
    event.preventDefault();
  }

  const menuToggleBtn = event.target.closest("[data-menu-toggle]");
  if (menuToggleBtn) {
    const postId = String(menuToggleBtn.getAttribute("data-menu-toggle"));
    const menu = document.getElementById(`post-menu-${postId}`);
    if (!menu) return;
    const open = menu.classList.contains("show");
    closeAllPostMenus();
    if (!open) menu.classList.add("show");
    return;
  }

  const toggleCommentsBtn = event.target.closest("[data-toggle-comments]");
  if (toggleCommentsBtn) {
    const postId = String(toggleCommentsBtn.getAttribute("data-toggle-comments"));
    if (commentsExpanded.has(postId)) commentsExpanded.delete(postId);
    else commentsExpanded.add(postId);
    applyFiltersStable();
    return;
  }

  const toggleReplyBtn = event.target.closest("[data-toggle-reply-form]");
  if (toggleReplyBtn) {
    const postId = String(toggleReplyBtn.getAttribute("data-toggle-reply-form") || "");
    const commentId = String(toggleReplyBtn.getAttribute("data-comment-id") || "");
    if (!postId || !commentId) return;
    const key = `${postId}::${commentId}`;
    if (replyFormsOpen.has(key)) replyFormsOpen.delete(key);
    else replyFormsOpen.add(key);
    if (shouldFullRerender("comment") || !updatePostCardUi(postId)) applyFiltersStable();
    return;
  }

  const focusCommentBtn = event.target.closest("[data-focus-comment]");
  if (focusCommentBtn) {
    const postId = String(focusCommentBtn.getAttribute("data-focus-comment"));
    if (commentsPanelOpen.has(postId)) {
      commentsPanelOpen.delete(postId);
    } else {
      commentsPanelOpen.add(postId);
      commentsExpanded.add(postId);
    }
    applyFiltersStable();
    if (commentsPanelOpen.has(postId)) {
      requestAnimationFrame(() => {
        const form = document.getElementById(`comment-form-${postId}`);
        const input = form ? form.querySelector('input[name="comment"]') : null;
        if (input) input.focus();
      });
    }
    return;
  }

  const shareBtn = event.target.closest("[data-share-post]");
  if (shareBtn) {
    const postId = String(shareBtn.getAttribute("data-share-post"));
    shareBtn.classList.add("is-sent");
    setTimeout(() => shareBtn.classList.remove("is-sent"), 650);
    openShareModal(postId);
    return;
  }

  const saveBtn = event.target.closest("[data-save-post]");
  if (saveBtn) {
    const postId = String(saveBtn.getAttribute("data-save-post"));
    saveBtn.disabled = true;
    try {
      const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        })
        : fetch(`${API_BASE}/${postId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }));
      if (res.ok) {
        const data = await res.json();
        if (data.saved) savedPostIds.add(postId);
        else savedPostIds.delete(postId);
      } else {
        if (savedPostIds.has(postId)) savedPostIds.delete(postId);
        else savedPostIds.add(postId);
      }
    } catch (err) {
      if (savedPostIds.has(postId)) savedPostIds.delete(postId);
      else savedPostIds.add(postId);
    }
    persistSavedPosts();
    saveBtn.disabled = false;
    if (shouldFullRerender("save") || !updatePostCardUi(postId)) applyFiltersStable();
    return;
  }

  const copyBtn = event.target.closest("[data-copy-link]");
  if (copyBtn) {
    const postId = String(copyBtn.getAttribute("data-copy-link") || "");
    if (!postId) return;
    copyBtn.disabled = true;
    try {
      await copyPostLink(postId);
      uploadStatus.textContent = "Post link copied.";
    } catch (err) {
      uploadStatus.textContent = "Could not copy link.";
    } finally {
      copyBtn.disabled = false;
      closeAllPostMenus();
    }
    return;
  }

  const collectionBtn = event.target.closest("[data-save-collection]");
  if (collectionBtn) {
    const postId = String(collectionBtn.getAttribute("data-save-collection") || "");
    if (!postId) return;
    collectionBtn.disabled = true;
    try {
      const ok = await savePostToCollection(postId);
      if (ok) uploadStatus.textContent = "Saved to collection.";
    } catch (err) {
      uploadStatus.textContent = err.message || "Could not save to collection.";
    } finally {
      collectionBtn.disabled = false;
      closeAllPostMenus();
    }
    return;
  }

  const reportBtn = event.target.closest("[data-report-post]");
  if (reportBtn) {
    const postId = String(reportBtn.getAttribute("data-report-post") || "");
    if (!postId) return;
    reportBtn.disabled = true;
    try {
      const submitted = await submitPostReport(postId);
      if (submitted) uploadStatus.textContent = "Post reported.";
    } catch (err) {
      uploadStatus.textContent = err.message || "Could not report post.";
    } finally {
      reportBtn.disabled = false;
      closeAllPostMenus();
    }
    return;
  }

  const editBtn = event.target.closest("[data-edit-post]");
  if (editBtn) {
    const postId = String(editBtn.getAttribute("data-edit-post") || "");
    if (!postId) return;
    editBtn.disabled = true;
    try {
      const updated = await editPostFlow(postId);
      if (updated) uploadStatus.textContent = "Post updated.";
    } catch (err) {
      uploadStatus.textContent = err.message || "Could not edit post.";
    } finally {
      editBtn.disabled = false;
      closeAllPostMenus();
    }
    return;
  }

  const likeBtn = event.target.closest("[data-like-post]");
  if (!likeBtn) return;
  const postId = likeBtn.getAttribute("data-like-post");
  likeBtn.disabled = true;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      : fetch(`${API_BASE}/${postId}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not update like");

    allPosts = allPosts.map((post) => {
      if (!sameId(post.id, postId)) return post;
      const likedBy = Array.isArray(post.likedBy) ? [...post.likedBy] : [];
      const hasLiked = likedBy.includes(username);
      let nextLikedBy = likedBy;
      if (data.liked && !hasLiked) nextLikedBy.push(username);
      if (!data.liked && hasLiked) nextLikedBy = likedBy.filter((u) => u !== username);
      return { ...post, likedBy: nextLikedBy, likesCount: data.likesCount };
    });
    if (shouldFullRerender("like") || !updatePostCardUi(postId)) applyFiltersStable();
  } catch (err) {
    uploadStatus.textContent = err.message;
  } finally {
    likeBtn.disabled = false;
  }
});

feed.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comment-form]");
  const replyForm = event.target.closest("[data-reply-form]");
  if (!form && !replyForm) return;
  event.preventDefault();

  if (replyForm) {
    const postId = String(replyForm.getAttribute("data-reply-form") || "");
    const commentId = String(replyForm.getAttribute("data-comment-id") || "");
    const input = replyForm.querySelector('input[name="reply"]');
    const replyText = String((input && input.value) || "").trim();
    if (!postId || !commentId || !replyText) return;
    const submitBtn = replyForm.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}/comment/${commentId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: replyText })
        })
        : fetch(`${API_BASE}/${postId}/comment/${commentId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: replyText })
        }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not add reply");
      if (input) input.value = "";

      allPosts = allPosts.map((post) => {
        if (!sameId(post.id, postId)) return post;
        const comments = Array.isArray(post.comments) ? post.comments.map((c) => {
          if (!sameId(c.id, commentId)) return c;
          const replies = Array.isArray(c.replies) ? [...c.replies] : [];
          replies.push(data.reply);
          return { ...c, replies };
        }) : [];
        return { ...post, comments };
      });
      replyFormsOpen.delete(`${postId}::${commentId}`);
      if (shouldFullRerender("comment") || !updatePostCardUi(postId)) applyFiltersStable();
    } catch (err) {
      uploadStatus.textContent = err.message;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    return;
  }

  const postId = form.getAttribute("data-comment-form");
  const input = form.querySelector('input[name="comment"]');
  const commentText = (input.value || "").trim();
  if (!commentText) return;

  const submitBtn = form.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText })
      })
      : fetch(`${API_BASE}/${postId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText })
      }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not add comment");
    input.value = "";
    updateCommentSendButtonState(form);

    allPosts = allPosts.map((post) => {
      if (!sameId(post.id, postId)) return post;
      return { ...post, comments: [...(post.comments || []), data.comment] };
    });
    if (shouldFullRerender("comment") || !updatePostCardUi(postId)) applyFiltersStable();
  } catch (err) {
    uploadStatus.textContent = err.message;
  } finally {
    submitBtn.classList.remove("is-loading");
    submitBtn.disabled = false;
    updateCommentSendButtonState(form);
  }
});

feed.addEventListener("click", async (event) => {
  const postBtn = event.target.closest("[data-delete-post]");
  if (!postBtn) return;
  const postId = postBtn.getAttribute("data-delete-post");
  if (!postId || !(await uiConfirm("Delete this post?", { tone: "danger", okText: "Delete" }))) return;

  postBtn.disabled = true;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      : fetch(`${API_BASE}/${postId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not delete post");
    allPosts = allPosts.filter((p) => !sameId(p.id, postId));
    savedPostIds.delete(String(postId));
    persistSavedPosts();
    commentsExpanded.delete(String(postId));
    applyFiltersStable();
  } catch (err) {
    uploadStatus.textContent = err.message;
  } finally {
    postBtn.disabled = false;
  }
});

feed.addEventListener("click", async (event) => {
  const replyBtn = event.target.closest("[data-delete-reply]");
  if (!replyBtn) return;
  const postId = String(replyBtn.getAttribute("data-delete-reply") || "");
  const commentId = String(replyBtn.getAttribute("data-comment-id") || "");
  const replyId = String(replyBtn.getAttribute("data-reply-id") || "");
  if (!postId || !commentId || !replyId || !(await uiConfirm("Delete this reply?", { tone: "danger", okText: "Delete" }))) return;

  replyBtn.disabled = true;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}/comment/${commentId}/reply/${replyId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      : fetch(`${API_BASE}/${postId}/comment/${commentId}/reply/${replyId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not delete reply");

    allPosts = allPosts.map((post) => {
      if (!sameId(post.id, postId)) return post;
      const comments = Array.isArray(post.comments) ? post.comments.map((c) => {
        if (!sameId(c.id, commentId)) return c;
        return {
          ...c,
          replies: (c.replies || []).filter((r) => !sameId(r.id, replyId))
        };
      }) : [];
      return { ...post, comments };
    });
    if (shouldFullRerender("comment") || !updatePostCardUi(postId)) applyFiltersStable();
  } catch (err) {
    uploadStatus.textContent = err.message;
  } finally {
    replyBtn.disabled = false;
  }
});

feed.addEventListener("click", async (event) => {
  const commentBtn = event.target.closest("[data-delete-comment]");
  if (!commentBtn) return;
  const postId = commentBtn.getAttribute("data-delete-comment");
  const commentId = commentBtn.getAttribute("data-comment-id");
  if (!postId || !commentId || !(await uiConfirm("Delete this comment?", { tone: "danger", okText: "Delete" }))) return;

  commentBtn.disabled = true;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${API_BASE}/${postId}/comment/${commentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      : fetch(`${API_BASE}/${postId}/comment/${commentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not delete comment");
    allPosts = allPosts.map((post) => {
      if (!sameId(post.id, postId)) return post;
      return {
        ...post,
        comments: (post.comments || []).filter((c) => !sameId(c.id, commentId))
      };
    });
    applyFiltersStable();
  } catch (err) {
    uploadStatus.textContent = err.message;
  } finally {
    commentBtn.disabled = false;
  }
});

[followersList, followingList].forEach((list) => {
  if (!list) return;
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-user-filter]");
    if (!row) return;
    const uname = row.getAttribute("data-user-filter");
    if (!uname) return;
    userSearchInput.value = uname;
    applyFilters();
  });
});

function initCreateButton() {
  if (!openCreateBtn) return;
  openCreateBtn.textContent = "Create";
  openCreateBtn.setAttribute("aria-expanded", "false");
  openCreateBtn.setAttribute("title", "Create");
  openCreateBtn.setAttribute("aria-label", "Create");
  function closeCreateChoices() {
    if (!createChoiceMenu) return;
    createChoiceMenu.classList.remove("show");
    createChoiceMenu.setAttribute("aria-hidden", "true");
    openCreateBtn.setAttribute("aria-expanded", "false");
  }

  function openCreateChoices() {
    if (!createChoiceMenu) return;
    createChoiceMenu.classList.add("show");
    createChoiceMenu.setAttribute("aria-hidden", "false");
    openCreateBtn.setAttribute("aria-expanded", "true");
  }

  openCreateBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (!createChoiceMenu) {
      window.location.href = "upload.html?mode=post";
      return;
    }
    if (createChoiceMenu.classList.contains("show")) {
      closeCreateChoices();
      return;
    }
    openCreateChoices();
  });

  if (createPostChoiceBtn) {
    createPostChoiceBtn.addEventListener("click", () => {
      closeCreateChoices();
      window.location.href = "upload.html?mode=post";
    });
  }

  if (createStoryChoiceBtn) {
    createStoryChoiceBtn.addEventListener("click", () => {
      closeCreateChoices();
      if (storyMediaInput) storyMediaInput.click();
    });
  }

  document.addEventListener("click", (event) => {
    if (!createChoiceMenu || !createChoiceMenu.classList.contains("show")) return;
    if (event.target === openCreateBtn || openCreateBtn.contains(event.target)) return;
    if (createChoiceMenu.contains(event.target)) return;
    closeCreateChoices();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCreateChoices();
  });
}

if (storiesRail) {
  storiesRail.addEventListener("click", (event) => {
    const addBtn = event.target.closest("[data-story-add]");
    if (addBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (storyMediaInput) storyMediaInput.click();
      return;
    }

    const openBtn = event.target.closest("[data-open-story-author]");
    if (!openBtn) return;
    event.preventDefault();
    event.stopPropagation();
    const author = openBtn.getAttribute("data-open-story-author");
    if (!author) return;
    if (author === username && !stories.some((s) => String(s.authorUsername) === username)) {
      if (storyMediaInput) storyMediaInput.click();
      return;
    }
    openStoryViewer(author);
  });

  storiesRail.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

if (storyMediaInput) {
  storyMediaInput.addEventListener("change", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const file = storyMediaInput.files && storyMediaInput.files[0];
    if (!file) return;
    await createStoryFromFile(file);
    storyMediaInput.value = "";
  });
}

userSearchInput.addEventListener("input", applyFilters);
clearUserSearchBtn.addEventListener("click", () => {
  userSearchInput.value = "";
  applyFilters();
  userSearchInput.focus();
});

if (feedFilters) {
  feedFilters.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-type-filter]");
    if (!chip) return;
    setTypeFilter(chip.getAttribute("data-type-filter"));
  });
}

if (feedSortSelect) {
  feedSortSelect.addEventListener("change", () => {
    activeSort = feedSortSelect.value || "newest";
    applyFilters();
  });
}

if (socket) {
  socket.on("connect", () => {
    socket.emit("userOnline", username);
  });

  socket.on("onlineUsers", (users) => {
    onlineUsersSet = new Set(Array.isArray(users) ? users : []);
    renderRelations();
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
    const targetUsername = sendBtn.getAttribute("data-share-user");
    if (!targetUsername) return;
    await sendPostToUser(targetUsername, sendBtn);
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
    uploadStatus.textContent = copied
      ? "Instagram opened. Link copied, paste it in your post or story."
      : "Instagram opened. Copy the post link and paste it in your post or story.";
  });
}

document.addEventListener("keydown", (event) => {
  if (storyViewerModal && storyViewerModal.classList.contains("show")) {
    if (event.key === "Escape") {
      closeStoryViewer();
      return;
    }
    if (event.key === "ArrowRight") {
      openStoryAt(storyViewerIndex + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      openStoryAt(storyViewerIndex - 1);
      return;
    }
  }

  if (event.key === "Escape" && shareModal && shareModal.classList.contains("show")) {
    closeShareModal();
  }
});

if (closeStoryViewerBtn) {
  closeStoryViewerBtn.addEventListener("click", closeStoryViewer);
}

if (deleteStoryBtn) {
  deleteStoryBtn.addEventListener("click", deleteCurrentStory);
}

if (storyPrevBtn) {
  storyPrevBtn.addEventListener("click", () => openStoryAt(storyViewerIndex - 1));
}

if (storyNextBtn) {
  storyNextBtn.addEventListener("click", () => openStoryAt(storyViewerIndex + 1));
}

if (storyViewerModal) {
  storyViewerModal.addEventListener("click", (event) => {
    if (event.target === storyViewerModal) closeStoryViewer();
  });
  storyViewerModal.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

if (storyReactionsBar) {
  storyReactionsBar.addEventListener("click", (event) => {
    const reactBtn = event.target.closest("[data-story-react]");
    if (!reactBtn) return;
    const emoji = reactBtn.getAttribute("data-story-react");
    reactToActiveStory(emoji);
  });
}

if (storyReplyForm) {
  storyReplyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    replyToActiveStory(storyReplyInput ? storyReplyInput.value : "");
  });
}

if (storyInteractionsBtn) {
  storyInteractionsBtn.addEventListener("click", () => {
    const story = getActiveStory();
    if (!story) return;
    const isShown = storyInteractionsPanel && storyInteractionsPanel.classList.contains("show");
    if (isShown) {
      storyInteractionsPanel.classList.remove("show");
      return;
    }
    loadOwnerStoryInteractions(story);
  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-menu-toggle]")) return;
  if (event.target.closest(".post-menu")) return;
  closeAllPostMenus();

});

window.addEventListener("hashchange", () => {
  focusPostFromHash();
});

initCreateButton();
loadStories();
setInterval(() => {
  // Avoid visible UI churn while story viewer is open.
  if (storyViewerModal && storyViewerModal.classList.contains("show")) return;
  loadStories();
}, 60000);
loadSavedPosts();
loadPosts();
loadRelations();


