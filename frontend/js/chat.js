const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
const socket = io(BACKEND_ORIGIN, (window.APP_CONFIG && window.APP_CONFIG.getSocketOptions && window.APP_CONFIG.getSocketOptions()) || { withCredentials: true });
const POST_SHARE_PREFIX = "__ASCAPDX_POST_SHARE__::";

const chatBox = document.getElementById("chatBox");
const followersListEl = document.getElementById("followersList");
const followingListEl = document.getElementById("followingList");
const threadsListEl = document.getElementById("threadsList");
const receiverInput = document.getElementById("receiver");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const voiceCallBtnTop = document.getElementById("voiceCallBtnTop");
const videoCallBtnTop = document.getElementById("videoCallBtnTop");
const muteConversationBtn = document.getElementById("muteConversationBtn");
const activeConversationChip = document.getElementById("activeConversationChip");
const activeConversationText = document.getElementById("activeConversationText");
const fileInput = document.getElementById("fileInput");
const pinnedMessageBar = document.getElementById("pinnedMessageBar");
const pinnedMessageText = document.getElementById("pinnedMessageText");
const jumpPinnedBtn = document.getElementById("jumpPinnedBtn");
const clearPinnedBtn = document.getElementById("clearPinnedBtn");
const replyingBar = document.getElementById("replyingBar");
const replyingText = document.getElementById("replyingText");
const clearReplyingBtn = document.getElementById("clearReplyingBtn");
const pageAlertEl = document.getElementById("pageAlert");
const pageConfirmEl = document.getElementById("pageConfirm");
const pageConfirmTextEl = document.getElementById("pageConfirmText");
const pageConfirmOkBtn = document.getElementById("pageConfirmOk");
const pageConfirmCancelBtn = document.getElementById("pageConfirmCancel");
const threadFilterAllBtn = document.getElementById("threadFilterAll");
const threadFilterUnreadBtn = document.getElementById("threadFilterUnread");
const threadFilterMutedBtn = document.getElementById("threadFilterMuted");

const session = (window.APP_CONFIG && window.APP_CONFIG.getSession && window.APP_CONFIG.getSession()) || null;
const username = session ? session.username : "";
const userId = session ? session.userId : "";

let onlineUsersSet = new Set();
const outgoingMessageNodes = new Map();
let profileRelations = { followers: [], following: [] };
const unreadCountsByUser = new Map();
const threadsByUser = new Map();
let activeConversation = "";
let pinnedByConversation = {};
let pageAlertTimer = null;
let confirmResolver = null;
const uiFeedback = window.UIFeedback || null;
let blockedUsersSet = new Set();
let typingStatusTimer = null;
let mutedUsersSet = new Set();
let pinnedThreadUsersSet = new Set();
let activeThreadFilter = "all";
let replyingTo = null;
let pendingUnreadDividerCount = 0;
let lastTypingEmitAt = 0;
let pinnedSyncTimer = null;
const REPLY_PREFIX = "__REPLY__::";
const TYPING_EMIT_INTERVAL_MS = 700;
const PINNED_SYNC_DEBOUNCE_MS = 700;
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MESSAGE_DELETE_WINDOW_MS = 15 * 60 * 1000;

function loadMutedUsersState() {
  try {
    const raw = localStorage.getItem(`chat_muted_${username}`);
    const arr = raw ? JSON.parse(raw) : [];
    mutedUsersSet = new Set(Array.isArray(arr) ? arr.map((u) => String(u || "")).filter(Boolean) : []);
  } catch (err) {
    mutedUsersSet = new Set();
  }
}

function saveMutedUsersState() {
  localStorage.setItem(`chat_muted_${username}`, JSON.stringify(Array.from(mutedUsersSet)));
}

function loadPinnedThreadState() {
  try {
    const raw = localStorage.getItem(`chat_pinned_threads_${username}`);
    const arr = raw ? JSON.parse(raw) : [];
    pinnedThreadUsersSet = new Set(Array.isArray(arr) ? arr.map((u) => String(u || "")).filter(Boolean) : []);
  } catch (err) {
    pinnedThreadUsersSet = new Set();
  }
}

function savePinnedThreadState() {
  localStorage.setItem(`chat_pinned_threads_${username}`, JSON.stringify(Array.from(pinnedThreadUsersSet)));
}

function togglePinnedThread(targetUsername) {
  const uname = String(targetUsername || "").trim();
  if (!uname) return;
  if (pinnedThreadUsersSet.has(uname)) pinnedThreadUsersSet.delete(uname);
  else pinnedThreadUsersSet.add(uname);
  savePinnedThreadState();
  renderThreads();
}

function setActiveThreadFilter(nextFilter) {
  const normalized = ["all", "unread", "muted"].includes(String(nextFilter || "")) ? String(nextFilter) : "all";
  activeThreadFilter = normalized;
  const map = {
    all: threadFilterAllBtn,
    unread: threadFilterUnreadBtn,
    muted: threadFilterMutedBtn
  };
  Object.keys(map).forEach((k) => {
    const btn = map[k];
    if (!btn) return;
    btn.classList.toggle("active", normalized === k);
  });
  renderThreads();
}

function normalizeMessageReactions(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      username: String((item && item.username) || ""),
      emoji: String((item && item.emoji) || "")
    }))
    .filter((item) => item.username && item.emoji);
}

function getMessageReactionsFromBubble(bubble) {
  if (!bubble) return [];
  try {
    const raw = String(bubble.dataset.reactions || "[]");
    return normalizeMessageReactions(JSON.parse(raw));
  } catch (err) {
    return [];
  }
}

function renderMessageReactions(bubble, reactionsInput) {
  if (!bubble) return;
  const reactions = normalizeMessageReactions(reactionsInput);
  bubble.dataset.reactions = JSON.stringify(reactions);

  let bar = bubble.querySelector(".chat-reactions");
  if (!reactions.length) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "chat-reactions";
    bubble.appendChild(bar);
  }

  const grouped = new Map();
  reactions.forEach((r) => {
    if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
    grouped.get(r.emoji).push(r.username);
  });

  bar.innerHTML = Array.from(grouped.entries()).map(([emoji, users]) => {
    const mine = users.includes(username);
    const count = users.length;
    return `<span class="reaction-chip" title="${escapeHtml(users.join(", "))}" style="${mine ? "border-color:rgba(123,245,197,.65);background:rgba(19,76,65,.42);" : ""}">${escapeHtml(emoji)} ${count}</span>`;
  }).join("");
}

function applyReactionUpdate(messageId, reactions) {
  const id = String(messageId || "");
  if (!id) return;
  const bubble = chatBox.querySelector(`[data-message-id="${escapeCssSelector(id)}"]`);
  if (!bubble) return;
  renderMessageReactions(bubble, reactions);
}

async function syncMutedUsersFromServer() {
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/users/settings`)
      : fetch(`${BACKEND_ORIGIN}/api/users/settings`, {
          headers: {}
        }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const serverMuted = Array.isArray(data.mutedUsers) ? data.mutedUsers.map((u) => String(u || "")).filter(Boolean) : [];
    mutedUsersSet = new Set(serverMuted);
    saveMutedUsersState();
  } catch (err) {}
}

function parseReplyMessage(rawMessage) {
  const raw = String(rawMessage || "");
  if (!raw.startsWith(REPLY_PREFIX)) return null;
  const boundaryIndex = raw.indexOf("::", REPLY_PREFIX.length);
  if (boundaryIndex < 0) return null;
  const encodedMeta = raw.slice(REPLY_PREFIX.length, boundaryIndex);
  const body = raw.slice(boundaryIndex + 2);
  try {
    const meta = JSON.parse(decodeURIComponent(encodedMeta));
    if (!meta || typeof meta !== "object") return null;
    return { meta, body };
  } catch (err) {
    return null;
  }
}

function composeReplyMessage(baseMessage) {
  if (!replyingTo || !replyingTo.messageId) return String(baseMessage || "");
  const meta = {
    messageId: String(replyingTo.messageId || ""),
    sender: String(replyingTo.sender || ""),
    preview: String(replyingTo.preview || "").slice(0, 120)
  };
  return `${REPLY_PREFIX}${encodeURIComponent(JSON.stringify(meta))}::${String(baseMessage || "")}`;
}

function clearReplyingState() {
  replyingTo = null;
  if (replyingBar) replyingBar.classList.remove("show");
  if (replyingText) replyingText.textContent = "";
}

function setReplyingState(payload) {
  replyingTo = payload || null;
  if (!replyingTo) {
    clearReplyingState();
    return;
  }
  if (replyingBar) replyingBar.classList.add("show");
  if (replyingText) {
    replyingText.textContent = `Replying to @${String(replyingTo.sender || "user")}: ${String(replyingTo.preview || "").slice(0, 72)}`;
  }
}

function showPageAlert(message, type = "info") {
  if (uiFeedback && typeof uiFeedback.toast === "function") {
    uiFeedback.toast(message, type);
    return;
  }
  if (!pageAlertEl) return;
  const safeType = type === "success" || type === "error" ? type : "info";
  pageAlertEl.textContent = String(message || "");
  pageAlertEl.className = `page-alert show ${safeType}`;
  if (pageAlertTimer) clearTimeout(pageAlertTimer);
  pageAlertTimer = setTimeout(() => {
    pageAlertEl.className = "page-alert";
    pageAlertEl.textContent = "";
  }, 3200);
}

function askPageConfirm(message) {
  if (uiFeedback && typeof uiFeedback.confirm === "function") {
    return uiFeedback.confirm(String(message || "Are you sure?"), { tone: "danger", okText: "Delete" });
  }
  if (!pageConfirmEl || !pageConfirmTextEl || !pageConfirmOkBtn || !pageConfirmCancelBtn) {
    return Promise.resolve(window.confirm(String(message || "Are you sure?")));
  }
  if (confirmResolver) {
    confirmResolver(false);
    confirmResolver = null;
  }
  pageConfirmTextEl.textContent = String(message || "Are you sure?");
  pageConfirmEl.classList.add("show");
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolvePageConfirm(value) {
  if (!confirmResolver) return;
  const resolver = confirmResolver;
  confirmResolver = null;
  if (pageConfirmEl) pageConfirmEl.classList.remove("show");
  resolver(!!value);
}

if (pageConfirmOkBtn) {
  pageConfirmOkBtn.addEventListener("click", () => resolvePageConfirm(true));
}
if (pageConfirmCancelBtn) {
  pageConfirmCancelBtn.addEventListener("click", () => resolvePageConfirm(false));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && confirmResolver) {
    resolvePageConfirm(false);
  }
});

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

function getMediaKindFromUrl(url) {
  const safe = sanitizeUrl(url, "");
  if (!safe) return null;
  const clean = safe.split("?")[0].split("#")[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(clean)) return "image";
  if (/\.(mp4|webm|ogg|mov|m4v|mkv)$/.test(clean)) return "video";
  return null;
}

function buildMediaViewerUrl(type, src) {
  const safeType = type === "video" ? "video" : "image";
  return `media-viewer.html?type=${encodeURIComponent(safeType)}&src=${encodeURIComponent(String(src || ""))}`;
}

function parseSharedPostMessage(text) {
  const raw = String(text || "");
  if (!raw.startsWith(POST_SHARE_PREFIX)) return null;
  const encoded = raw.slice(POST_SHARE_PREFIX.length);
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!parsed || parsed.type !== "post_share" || !parsed.postId) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function isSharedPostText(text) {
  return !!parseSharedPostMessage(text);
}

function isMediaMessageText(text) {
  const msg = String(text || "");
  if (!msg) return false;
  if (!(msg.startsWith("http://") || msg.startsWith("https://") || msg.startsWith("/uploads/"))) return false;
  return !!getMediaKindFromUrl(msg);
}

function canEditMessageBubble(bubble) {
  if (!bubble) return false;
  const sender = String(bubble.dataset.sender || "");
  const isFile = bubble.dataset.isFile === "true";
  const text = String(bubble.dataset.messageText || "");
  const createdAtMs = Number(bubble.dataset.createdAtMs || 0);
  const withinWindow = createdAtMs > 0 && (Date.now() - createdAtMs) <= MESSAGE_EDIT_WINDOW_MS;
  return sender === username && !isFile && !isSharedPostText(text) && withinWindow;
}

function canDeleteMessageBubble(bubble) {
  if (!bubble) return false;
  const sender = String(bubble.dataset.sender || "");
  const createdAtMs = Number(bubble.dataset.createdAtMs || 0);
  const withinWindow = createdAtMs > 0 && (Date.now() - createdAtMs) <= MESSAGE_DELETE_WINDOW_MS;
  return sender === username && withinWindow;
}

function buildSharedPostCard(shared) {
  const postId = escapeHtml(shared.postId || "");
  const display = escapeHtml(shared.authorDisplayName || shared.authorUsername || "User");
  const uname = escapeHtml(shared.authorUsername || "user");
  const verifiedBadge = shared.authorVerified
    ? '<i class="bi bi-patch-check-fill" title="Verified" style="color:#79d8ff;margin-left:0.2rem;"></i>'
    : "";
  const caption = escapeHtml(shared.caption || "");
  const mediaUrl = sanitizeUrl(shared.mediaUrl, "");
  const mediaType = shared.mediaType === "video" ? "video" : "image";
  const postHref = `index.html#post-${encodeURIComponent(String(shared.postId || ""))}`;
  const media = mediaUrl
    ? (mediaType === "video"
      ? `<video src="${escapeHtml(mediaUrl)}" controls playsinline style="width:100%;max-height:240px;border-radius:8px;background:#08121f;"></video>`
      : `<img src="${escapeHtml(mediaUrl)}" alt="Shared post ${postId}" style="width:100%;max-height:240px;object-fit:cover;border-radius:8px;background:#08121f;">`)
    : `<div style="padding:0.7rem;border:1px dashed #35557a;border-radius:8px;color:#b5cce2;font-size:0.82rem;">Media unavailable</div>`;

  return `
    <div style="border:1px solid #345474;border-radius:12px;padding:0.55rem;background:#0b1a2c;margin-top:0.25rem;max-width:360px;">
      <div style="color:#d8ecff;font-weight:700;font-size:0.84rem;margin-bottom:0.4rem;">Shared post from ${display}${verifiedBadge} <span style="color:#8fb0d0;font-weight:500;">@${uname}</span></div>
      ${media}
      ${caption ? `<div style="margin-top:0.45rem;color:#d8ecff;font-size:0.84rem;line-height:1.35;">${caption}</div>` : ""}
      <a href="${postHref}" target="_blank" style="display:inline-block;margin-top:0.55rem;padding:0.25rem 0.6rem;border-radius:999px;background:#2196f3;color:#031321;text-decoration:none;font-size:0.78rem;font-weight:700;">Open post</a>
    </div>
  `;
}

function addKnownUser(name) {
  if (!name) return;
  const raw = localStorage.getItem("known_users");
  let users = [];
  if (raw) {
    try {
      users = JSON.parse(raw);
    } catch (err) {
      users = [];
    }
  }
  if (!users.includes(name)) {
    users.push(name);
    localStorage.setItem("known_users", JSON.stringify(users));
  }
}

function getRoom(user1, user2) {
  return [user1, user2].sort().join("_");
}

function getConversationKey(targetUsername) {
  if (!username || !targetUsername) return "";
  return [username, String(targetUsername)].sort().join("__");
}

function loadPinnedState() {
  const raw = localStorage.getItem(`chat_pinned_${username}`);
  if (!raw) {
    pinnedByConversation = {};
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    pinnedByConversation = parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    pinnedByConversation = {};
  }
}

function savePinnedState() {
  localStorage.setItem(`chat_pinned_${username}`, JSON.stringify(pinnedByConversation || {}));
}

function queuePinnedStateSync() {
  if (!username) return;
  if (pinnedSyncTimer) clearTimeout(pinnedSyncTimer);
  pinnedSyncTimer = setTimeout(() => {
    pinnedSyncTimer = null;
    syncPinnedStateToServer();
  }, PINNED_SYNC_DEBOUNCE_MS);
}

async function syncPinnedStateFromServer() {
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/users/settings`)
      : fetch(`${BACKEND_ORIGIN}/api/users/settings`, {
          headers: {}
        }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const serverPinned = (data && data.pinnedChats && typeof data.pinnedChats === "object") ? data.pinnedChats : {};
    if (serverPinned && Object.keys(serverPinned).length) {
      pinnedByConversation = serverPinned;
      savePinnedState();
      renderPinnedBar();
    }
  } catch (err) {}
}

async function syncPinnedStateToServer() {
  try {
    await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/users/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinnedChats: pinnedByConversation })
        })
      : fetch(`${BACKEND_ORIGIN}/api/users/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            
          },
          body: JSON.stringify({ pinnedChats: pinnedByConversation })
        }));
  } catch (err) {}
}

function clearPinnedStyle() {
  chatBox.querySelectorAll(".pinned-message").forEach((node) => node.classList.remove("pinned-message"));
}

function renderPinnedBar() {
  if (!pinnedMessageBar || !pinnedMessageText) return;
  const key = getConversationKey(activeConversation);
  const pinned = key ? pinnedByConversation[key] : null;
  if (!pinned || !pinned.messageId) {
    pinnedMessageBar.classList.remove("show");
    pinnedMessageText.textContent = "";
    clearPinnedStyle();
    return;
  }
  pinnedMessageText.textContent = `Pinned: ${String(pinned.preview || "Message")}`;
  pinnedMessageBar.classList.add("show");
  clearPinnedStyle();
  const node = chatBox.querySelector(`[data-message-id="${escapeCssSelector(pinned.messageId)}"]`);
  if (node) node.classList.add("pinned-message");
}

function setPinnedMessage(messageId, previewText) {
  const key = getConversationKey(activeConversation);
  if (!key || !messageId) return;
  pinnedByConversation[key] = {
    messageId: String(messageId),
    preview: String(previewText || "").slice(0, 100) || "Message"
  };
  savePinnedState();
  queuePinnedStateSync();
  renderPinnedBar();
}

function clearPinnedMessageForActiveConversation() {
  const key = getConversationKey(activeConversation);
  if (!key || !pinnedByConversation[key]) return;
  delete pinnedByConversation[key];
  savePinnedState();
  queuePinnedStateSync();
  renderPinnedBar();
}

function maybeDropPinnedMessage(messageId) {
  const id = String(messageId || "");
  if (!id) return;
  const keys = Object.keys(pinnedByConversation || {});
  let changed = false;
  keys.forEach((key) => {
    if (pinnedByConversation[key] && String(pinnedByConversation[key].messageId || "") === id) {
      delete pinnedByConversation[key];
      changed = true;
    }
  });
  if (changed) {
    savePinnedState();
    queuePinnedStateSync();
    renderPinnedBar();
  }
}

function buildReplyPreviewHtml(parsedReply) {
  if (!parsedReply || !parsedReply.meta) return "";
  const targetId = String(parsedReply.meta.messageId || "");
  const sender = escapeHtml(parsedReply.meta.sender || "user");
  const preview = escapeHtml(parsedReply.meta.preview || "");
  return `<button type="button" class="reply-jump-chip" data-reply-target="${escapeHtml(targetId)}" style="display:block;margin:0.2rem 0 0.35rem;padding:0.22rem 0.45rem;border:1px solid rgba(139,205,251,.45);border-left:3px solid rgba(139,205,251,.72);background:rgba(24,56,87,.34);border-radius:6px;color:#b9d9f5;font-size:0.76rem;text-align:left;cursor:pointer;">Reply to @${sender}: ${preview}</button>`;
}

function escapeCssSelector(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value || ""));
  return String(value || "").replace(/"/g, '\\"');
}

function formatThreadTime(dateValue) {
  const ts = new Date(dateValue || 0).getTime();
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}

function formatMessageTimestamp(dateValue) {
  const parsed = dateValue ? new Date(dateValue) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const now = new Date();
  const dayStartNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStartMsg = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((dayStartNow - dayStartMsg) / (24 * 60 * 60 * 1000));
  const timePart = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (dayDiff === 0) return timePart;
  if (dayDiff === 1) return `Yesterday ${timePart}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${timePart}`;
  }
  return `${date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })} ${timePart}`;
}

function toPreviewText(rawMessage) {
  const replied = parseReplyMessage(rawMessage);
  if (replied) return replied.body || "Reply";
  const sharedPost = parseSharedPostMessage(rawMessage);
  if (sharedPost) return "Shared a post";
  const msg = String(rawMessage || "");
  if (!msg) return "";
  if (msg.startsWith("http://") || msg.startsWith("https://") || msg.startsWith("/uploads/")) {
    const kind = getMediaKindFromUrl(msg);
    if (kind === "image") return "Sent an image";
    if (kind === "video") return "Sent a video";
    return "Sent a file";
  }
  return msg;
}

function getUserMeta(targetUsername) {
  const all = [...(profileRelations.followers || []), ...(profileRelations.following || [])];
  const found = all.find((u) => u && u.username === targetUsername);
  return {
    username: targetUsername,
    name: (found && found.name) || targetUsername,
    avatarUrl: (found && found.avatarUrl) || "assets/default-avatar.svg"
  };
}

function upsertThread(targetUsername, updates = {}) {
  if (!targetUsername) return;
  const base = threadsByUser.get(targetUsername) || getUserMeta(targetUsername);
  const next = { ...base, ...updates, username: targetUsername };
  threadsByUser.set(targetUsername, next);
}

function setUnreadCount(targetUsername, value) {
  if (!targetUsername) return;
  const n = Math.max(0, Number(value || 0));
  unreadCountsByUser.set(targetUsername, n);
}

function incrementUnread(targetUsername, add = 1) {
  if (!targetUsername) return;
  const current = Number(unreadCountsByUser.get(targetUsername) || 0);
  unreadCountsByUser.set(targetUsername, current + Math.max(1, Number(add || 1)));
}

function isDeletedUserError(payload) {
  const text = String((payload && payload.error) || (payload && payload.message) || "").toLowerCase();
  return text.includes("user not found") || text.includes("users not found");
}

function removeDeletedUserFromSendTargets(targetUsername) {
  const target = String(targetUsername || "").trim();
  if (!target) return;

  try {
    const raw = localStorage.getItem("known_users");
    const users = raw ? JSON.parse(raw) : [];
    const next = (Array.isArray(users) ? users : []).filter((u) => String(u || "") !== target);
    localStorage.setItem("known_users", JSON.stringify(next));
  } catch (err) {}

  profileRelations = {
    followers: (profileRelations.followers || []).filter((u) => String((u && u.username) || "") !== target),
    following: (profileRelations.following || []).filter((u) => String((u && u.username) || "") !== target)
  };

  threadsByUser.delete(target);
  unreadCountsByUser.delete(target);
  mutedUsersSet.delete(target);
  pinnedThreadUsersSet.delete(target);
  saveMutedUsersState();
  savePinnedThreadState();

  if (activeConversation === target) {
    activeConversation = "";
    if (receiverInput) receiverInput.value = "";
    localStorage.removeItem("receiver");
    if (chatBox) chatBox.innerHTML = "";
  }

  renderRelations();
  renderThreads();
  renderPinnedBar();
  updateComposerTargetUi();
  showPageAlert(`@${target} account was deleted or not found. Removed from send list.`, "info");
}

function renderRelationsList(container, users) {
  if (!container) return;
  if (!Array.isArray(users) || users.length === 0) {
    container.innerHTML = '<p class="empty-rel">No users</p>';
    return;
  }

  container.innerHTML = users.map((user) => {
    const uname = user.username || "";
    const display = user.name || uname;
    const avatarUrl = user.avatarUrl || "assets/default-avatar.svg";
    const safeUname = escapeHtml(uname);
    const safeDisplay = escapeHtml(display);
    const safeAvatarUrl = escapeHtml(avatarUrl);
    const isOnline = onlineUsersSet.has(uname);
    const unreadCount = Number(unreadCountsByUser.get(uname) || 0);
    return `
      <div class="relation-item" data-username="${safeUname}" role="button" tabindex="0" aria-label="Chat with @${safeUname}">
        <div class="relation-main">
          <img class="relation-avatar" src="${safeAvatarUrl}" alt="${safeDisplay}" onerror="this.src='assets/default-avatar.svg'">
          <span class="relation-name">${safeDisplay}</span>
        </div>
        <div class="relation-trailing">
          ${unreadCount > 0 ? '<span class="unread-dot"></span>' : ""}
          <span class="status-pill ${isOnline ? "online" : ""}">${isOnline ? "online" : "offline"}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderRelations() {
  renderRelationsList(followersListEl, profileRelations.followers);
  renderRelationsList(followingListEl, profileRelations.following);
}

function renderThreads() {
  if (!threadsListEl) return;
  const items = Array.from(threadsByUser.values())
    .sort((a, b) => {
    const ap = pinnedThreadUsersSet.has(String((a && a.username) || "")) ? 1 : 0;
    const bp = pinnedThreadUsersSet.has(String((b && b.username) || "")) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ta = new Date(a.lastMessageAt || 0).getTime();
    const tb = new Date(b.lastMessageAt || 0).getTime();
    return tb - ta;
  });
  const filteredItems = items.filter((item) => {
    const uname = String((item && item.username) || "");
    if (!uname) return false;
    if (activeThreadFilter === "unread") {
      return Number(unreadCountsByUser.get(uname) || 0) > 0;
    }
    if (activeThreadFilter === "muted") {
      return mutedUsersSet.has(uname);
    }
    return true;
  });

  if (!filteredItems.length) {
    threadsListEl.innerHTML = '<p class="empty-rel">No conversations.</p>';
    return;
  }

  threadsListEl.innerHTML = filteredItems.map((item) => {
    const uname = item.username || "";
    const name = escapeHtml(item.name || uname);
    const avatarUrl = escapeHtml(item.avatarUrl || "assets/default-avatar.svg");
    const preview = escapeHtml(toPreviewText(item.lastMessage || ""));
    const time = escapeHtml(formatThreadTime(item.lastMessageAt || ""));
    const unreadCount = Number(unreadCountsByUser.get(uname) || 0);
    const activeClass = activeConversation === uname ? " active" : "";
    const unreadBadge = unreadCount > 0 ? `<span class="thread-unread">${unreadCount > 99 ? "99+" : unreadCount}</span>` : "";
    const isPinned = pinnedThreadUsersSet.has(uname);
    return `
      <article class="thread-item${activeClass}" data-thread-user="${escapeHtml(uname)}" role="button" tabindex="0" aria-label="Open conversation with @${escapeHtml(uname)}">
        <img class="relation-avatar" src="${avatarUrl}" alt="${name}" onerror="this.src='assets/default-avatar.svg'">
        <div class="thread-content">
          <div class="thread-name-line">
            <div class="thread-name">${name}</div>
            <button type="button" class="thread-pin-btn${isPinned ? " active" : ""}" data-pin-thread="${escapeHtml(uname)}" title="${isPinned ? "Unpin conversation" : "Pin conversation"}">${isPinned ? "Pin" : "Pin"}</button>
          </div>
          <div class="thread-preview">${preview || "&nbsp;"}</div>
        </div>
        <div class="thread-meta">
          <span class="thread-time">${time}</span>
          ${unreadBadge}
        </div>
      </article>
    `;
  }).join("");
}

function updateComposerTargetUi() {
  const hasActive = !!activeConversation;
  if (activeConversationChip) {
    activeConversationChip.classList.toggle("show", hasActive);
  }
  if (activeConversationText) {
    activeConversationText.textContent = hasActive
      ? `@${activeConversation}`
      : "Select user";
  }
  if (receiverInput) {
    receiverInput.style.display = hasActive ? "none" : "";
  }
  updateSendButtonState();
  updateCallLinks();
  if (muteConversationBtn) {
    if (!hasActive) {
      muteConversationBtn.textContent = "Mute";
      muteConversationBtn.disabled = true;
    } else {
      const muted = mutedUsersSet.has(activeConversation);
      muteConversationBtn.textContent = muted ? "Unmute" : "Mute";
      muteConversationBtn.disabled = false;
    }
  }
}

function updateSendButtonState() {
  if (!sendBtn) return;
  const receiver = String(activeConversation || (receiverInput && receiverInput.value) || "").trim();
  const msgText = String((messageInput && messageInput.value) || "").trim();
  const hasFile = !!(fileInput && fileInput.files && fileInput.files.length > 0);
  sendBtn.disabled = !receiver || (!msgText && !hasFile);
}

function updateCallLinks() {
  const target = String(activeConversation || "").trim();
  const makeHref = (base) => {
    if (!target) return base;
    return `${base}?u=${encodeURIComponent(target)}`;
  };
  if (voiceCallBtnTop) voiceCallBtnTop.setAttribute("href", makeHref("voice-call.html"));
  if (videoCallBtnTop) videoCallBtnTop.setAttribute("href", makeHref("video-call.html"));
}

function appendMessage(sender, text, isFile = false, options = {}) {
  const msg = document.createElement("div");
  msg.className = "chat-msg";
  const time = formatMessageTimestamp(options.timeValue || Date.now());
  const safeSender = escapeHtml(sender);
  const parsedReply = parseReplyMessage(text);
  const displayText = parsedReply ? String(parsedReply.body || "") : text;
  const sharedPost = parseSharedPostMessage(displayText);
  const replyHtml = buildReplyPreviewHtml(parsedReply);
  if (sharedPost) {
    msg.innerHTML = `<strong>${safeSender}</strong>: <span style="color:#8fb0d0;font-size:0.72rem;">${time}</span>${replyHtml}${buildSharedPostCard(sharedPost)}`;
  } else if (isFile) {
    const fileUrl = sanitizeUrl(displayText, "");
    const mediaKind = getMediaKindFromUrl(fileUrl);
    if (mediaKind === "image") {
      const viewUrl = buildMediaViewerUrl("image", fileUrl);
      msg.innerHTML = `
        <strong>${safeSender}</strong>: <span style="color:gray;font-size:0.75rem;">${time}</span>
        <div class="chat-media-wrap">
          <a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener noreferrer">
            <img class="chat-media" src="${escapeHtml(fileUrl)}" alt="Shared image">
          </a>
        </div>
      `;
    } else if (mediaKind === "video") {
      const viewUrl = buildMediaViewerUrl("video", fileUrl);
      msg.innerHTML = `
        <strong>${safeSender}</strong>: <span style="color:gray;font-size:0.75rem;">${time}</span>
        <div class="chat-media-wrap video">
          <a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener noreferrer">
            <video class="chat-media chat-media-video chat-media-video-static" src="${escapeHtml(fileUrl)}" muted playsinline preload="metadata"></video>
          </a>
        </div>
      `;
    } else {
      msg.innerHTML = `<strong>${safeSender}</strong>: ${replyHtml}<a href="${escapeHtml(fileUrl || "#")}" target="_blank" rel="noopener noreferrer">Open file</a> <span style="color:gray;font-size:0.75rem;">${time}</span>`;
    }
  } else {
    msg.innerHTML = `<strong>${safeSender}</strong>: ${replyHtml}${escapeHtml(displayText)} <span style="color:gray;font-size:0.55rem;">${time}</span>`;
  }
  msg.dataset.sender = String(sender || "");
  msg.dataset.isFile = isFile ? "true" : "false";
  msg.dataset.messageText = String(displayText || "");
  msg.dataset.timeText = time;
  const createdAtMs = new Date(options.timeValue || Date.now()).getTime();
  msg.dataset.createdAtMs = Number.isFinite(createdAtMs) ? String(createdAtMs) : String(Date.now());
  attachMessageMenu(msg, null);
  renderMessageReactions(msg, options.reactions || []);
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function appendPendingMessage(label = "Sending") {
  const msg = document.createElement("div");
  msg.className = "msg-pending";
  msg.innerHTML = `
    <strong>${escapeHtml(username)}</strong>:
    <span class="sending-badge">
      ${escapeHtml(label)}
      <span class="sending-dots"><i></i><i></i><i></i></span>
    </span>
  `;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function appendOwnMessageWithStatus(text, isFile = false, status = "Sending", options = {}) {
  const msg = document.createElement("div");
  msg.className = "chat-msg";
  const time = formatMessageTimestamp(options.timeValue || Date.now());
  const safeSender = escapeHtml(username);
  const parsedReply = parseReplyMessage(text);
  const displayText = parsedReply ? String(parsedReply.body || "") : text;
  const sharedPost = parseSharedPostMessage(displayText);
  const replyHtml = buildReplyPreviewHtml(parsedReply);
  if (sharedPost) {
    msg.innerHTML = `<strong>${safeSender}</strong>: <span style="color:#8fb0d0;font-size:0.72rem;">${time}</span>${replyHtml}${buildSharedPostCard(sharedPost)} <span data-msg-status style="color:#8fb0d0;font-size:0.72rem;">${escapeHtml(status)}</span>`;
  } else if (isFile) {
    const fileUrl = sanitizeUrl(displayText, "");
    const mediaKind = getMediaKindFromUrl(fileUrl);
    if (mediaKind === "image") {
      const viewUrl = buildMediaViewerUrl("image", fileUrl);
      msg.innerHTML = `
        <strong>${safeSender}</strong>: <span style="color:gray;font-size:0.75rem;">${time}</span>
        <div class="chat-media-wrap">
          <a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener noreferrer">
            <img class="chat-media" src="${escapeHtml(fileUrl)}" alt="Sent image">
          </a>
        </div>
        <span data-msg-status style="color:#8fb0d0;font-size:0.72rem;">${escapeHtml(status)}</span>
      `;
    } else if (mediaKind === "video") {
      const viewUrl = buildMediaViewerUrl("video", fileUrl);
      msg.innerHTML = `
        <strong>${safeSender}</strong>: <span style="color:gray;font-size:0.75rem;">${time}</span>
        <div class="chat-media-wrap video">
          <a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener noreferrer">
            <video class="chat-media chat-media-video chat-media-video-static" src="${escapeHtml(fileUrl)}" muted playsinline preload="metadata"></video>
          </a>
        </div>
        <span data-msg-status style="color:#8fb0d0;font-size:0.72rem;">${escapeHtml(status)}</span>
      `;
    } else {
      msg.innerHTML = `<strong>${safeSender}</strong>: ${replyHtml}<a href="${escapeHtml(fileUrl || "#")}" target="_blank" rel="noopener noreferrer">Open file</a> <span style="color:gray;font-size:0.75rem;">${time}</span> <span data-msg-status style="color:#8fb0d0;font-size:0.72rem;">${escapeHtml(status)}</span>`;
    }
  } else {
    msg.innerHTML = `<strong>${safeSender}</strong>: ${replyHtml}${escapeHtml(displayText)} <span style="color:gray;font-size:0.55rem;">${time}</span> <span data-msg-status style="color:#8fb0d0;font-size:0.72rem;">${escapeHtml(status)}</span>`;
  }
  msg.dataset.sender = String(username || "");
  msg.dataset.isFile = isFile ? "true" : "false";
  msg.dataset.messageText = String(displayText || "");
  msg.dataset.timeText = time;
  const createdAtMs = new Date(options.timeValue || Date.now()).getTime();
  msg.dataset.createdAtMs = Number.isFinite(createdAtMs) ? String(createdAtMs) : String(Date.now());
  attachMessageMenu(msg, null);
  renderMessageReactions(msg, options.reactions || []);
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function setBubbleStatus(bubble, status, isError = false) {
  if (!bubble) return;
  const node = bubble.querySelector("[data-msg-status]");
  if (!node) return;
  node.textContent = status;
  node.style.color = isError ? "#ff9b9b" : (status === "Seen" ? "#7ff2ce" : "#8fb0d0");
}

function setBubbleFailedWithRetry(bubble, payload) {
  if (!bubble) return;
  setBubbleStatus(bubble, "Failed", true);
  bubble.dataset.retryPayload = encodeURIComponent(JSON.stringify(payload || {}));
  let retryBtn = bubble.querySelector("[data-retry-send]");
  if (!retryBtn) {
    retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.setAttribute("data-retry-send", "1");
    retryBtn.style.marginLeft = "0.4rem";
    retryBtn.style.fontSize = "0.72rem";
    retryBtn.style.padding = "0.1rem 0.35rem";
    retryBtn.style.border = "1px solid rgba(255,155,155,.55)";
    retryBtn.style.borderRadius = "999px";
    retryBtn.style.background = "rgba(50,17,24,.6)";
    retryBtn.style.color = "#ffd0d0";
    retryBtn.style.cursor = "pointer";
    retryBtn.textContent = "Retry";
    bubble.appendChild(retryBtn);
  }
}

function clearBubbleRetryState(bubble) {
  if (!bubble) return;
  delete bubble.dataset.retryPayload;
  const retryBtn = bubble.querySelector("[data-retry-send]");
  if (retryBtn) retryBtn.remove();
}

function attachMessageIdToBubble(bubble, messageId) {
  if (!bubble || !messageId) return;
  const id = String(messageId);
  bubble.dataset.messageId = id;
  outgoingMessageNodes.set(id, bubble);
  attachMessageMenu(bubble, id);
}

function attachMessageMenu(bubble, messageId) {
  if (!bubble) return;
  let wrap = bubble.querySelector(".msg-menu-wrap");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "msg-menu-wrap";
    wrap.innerHTML = `
      <button type="button" class="msg-menu-btn" aria-label="Message options">...</button>
      <div class="msg-menu-panel">
        <button type="button" class="msg-reply-btn">Reply</button>
        <button type="button" class="msg-react-btn">React</button>
        <button type="button" class="msg-pin-btn">Pin</button>
        <button type="button" class="msg-edit-btn">Edit</button>
        <button type="button" class="msg-delete-btn">Delete</button>
      </div>
    `;
    bubble.appendChild(wrap);
  }

  const replyBtn = wrap.querySelector(".msg-reply-btn");
  const reactBtn = wrap.querySelector(".msg-react-btn");
  const pinBtn = wrap.querySelector(".msg-pin-btn");
  const editBtn = wrap.querySelector(".msg-edit-btn");
  const deleteBtn = wrap.querySelector(".msg-delete-btn");
  const toggleBtn = wrap.querySelector(".msg-menu-btn");
  const id = messageId ? String(messageId) : String(bubble.dataset.messageId || "");
  const isOwn = String(bubble.dataset.sender || "") === username;
  const canEdit = canEditMessageBubble(bubble);
  const canDelete = canDeleteMessageBubble(bubble);

  if (id) {
    replyBtn.disabled = false;
    replyBtn.setAttribute("data-reply-message", id);
    reactBtn.disabled = false;
    reactBtn.setAttribute("data-react-message", id);
    pinBtn.disabled = false;
    pinBtn.setAttribute("data-pin-message", id);
    editBtn.disabled = !canEdit;
    if (canEdit) editBtn.setAttribute("data-edit-message", id);
    else editBtn.removeAttribute("data-edit-message");
    deleteBtn.disabled = !canDelete;
    if (canDelete) deleteBtn.setAttribute("data-delete-message", id);
    else deleteBtn.removeAttribute("data-delete-message");
  } else {
    replyBtn.disabled = true;
    reactBtn.disabled = true;
    pinBtn.disabled = true;
    editBtn.disabled = true;
    deleteBtn.disabled = true;
    pinBtn.removeAttribute("data-pin-message");
    reactBtn.removeAttribute("data-react-message");
    editBtn.removeAttribute("data-edit-message");
    deleteBtn.removeAttribute("data-delete-message");
  }

  const key = getConversationKey(activeConversation);
  const pinned = key ? pinnedByConversation[key] : null;
  pinBtn.textContent = (pinned && String(pinned.messageId || "") === id) ? "Unpin" : "Pin";

  if (!id && !isOwn) {
    toggleBtn.disabled = true;
    wrap.classList.add("disabled");
    return;
  }

  toggleBtn.disabled = false;
  wrap.classList.remove("disabled");
}

function closeAllMessageMenus() {
  chatBox.querySelectorAll(".msg-menu-panel.show").forEach((panel) => panel.classList.remove("show"));
}

function removeMessageBubble(messageId) {
  const id = String(messageId || "");
  if (!id) return;
  const node = chatBox.querySelector(`[data-message-id="${escapeCssSelector(id)}"]`);
  if (node) node.remove();
  outgoingMessageNodes.delete(id);
  maybeDropPinnedMessage(id);
}

function updateMessageBubbleText(messageId, nextText) {
  const id = String(messageId || "");
  const node = id ? chatBox.querySelector(`[data-message-id="${escapeCssSelector(id)}"]`) : null;
  if (!node) return;
  const existingReactions = getMessageReactionsFromBubble(node);
  node.dataset.messageText = String(nextText || "");
  const sender = escapeHtml(String(node.dataset.sender || ""));
  const timeText = escapeHtml(String(node.dataset.timeText || formatMessageTimestamp(Date.now())));
  const createdAtText = `<span style="color:gray;font-size:0.55rem;">${timeText}</span>`;
  const statusNode = node.querySelector("[data-msg-status]");
  const statusHtml = statusNode ? ` ${statusNode.outerHTML}` : "";
  node.innerHTML = `<strong>${sender}</strong>: ${escapeHtml(nextText)} ${createdAtText} <span style="color:#9ec3e7;font-size:0.7rem;">(edited)</span>${statusHtml}`;
  attachMessageMenu(node, id);
  renderMessageReactions(node, existingReactions);
  renderPinnedBar();
}

async function deleteConversationWithUser(targetUsername) {
  const target = String(targetUsername || "").trim();
  if (!target || target === username) return;
  const shouldDelete = await askPageConfirm(`Delete conversation with @${target}?`);
  if (!shouldDelete) return;

  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/messages/conversation/${encodeURIComponent(target)}`, { method: "DELETE" })
      : fetch(`${BACKEND_ORIGIN}/api/messages/conversation/${encodeURIComponent(target)}`, { method: "DELETE" }));
    const data = await res.json();
    if (!res.ok) {
      showPageAlert((data && data.message) || "Failed to delete conversation", "error");
      return;
    }
    threadsByUser.delete(target);
    unreadCountsByUser.delete(target);
    const key = getConversationKey(target);
    if (key && pinnedByConversation[key]) {
      delete pinnedByConversation[key];
      savePinnedState();
    }
    if (activeConversation === target) {
      activeConversation = "";
      if (receiverInput) receiverInput.value = "";
      localStorage.removeItem("receiver");
      chatBox.innerHTML = "";
    }
    renderRelations();
    renderThreads();
    renderPinnedBar();
    showPageAlert(`Conversation with @${target} deleted.`, "success");
  } catch (err) {
    console.error(err);
    showPageAlert("Failed to delete conversation", "error");
  }
}

async function loadRelations() {
  if (!username) return;
  try {
    const res = await fetch(`${BACKEND_ORIGIN}/api/users/profile/${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!res.ok) return;

    profileRelations = {
      followers: Array.isArray(data.followers) ? data.followers : [],
      following: Array.isArray(data.following) ? data.following : []
    };
    profileRelations.followers.forEach((u) => addKnownUser(u && u.username));
    profileRelations.following.forEach((u) => addKnownUser(u && u.username));

    renderRelations();
    renderThreads();
  } catch (err) {
    console.error(err);
  }
}

async function loadBlockedUsers() {
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/users/blocks`)
      : fetch(`${BACKEND_ORIGIN}/api/users/blocks`, {
          headers: {}
        }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      blockedUsersSet = new Set();
      return;
    }
    const items = Array.isArray(data.items) ? data.items : [];
    blockedUsersSet = new Set(items.map((u) => String((u && u.username) || "")).filter(Boolean));
  } catch (err) {
    blockedUsersSet = new Set();
  }
}

async function loadThreads() {
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/messages/threads`)
      : fetch(`${BACKEND_ORIGIN}/api/messages/threads`));
    const data = await res.json();
    if (!res.ok) return;
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach((item) => {
      if (!item || !item.username) return;
      upsertThread(item.username, {
        name: item.name || item.username,
        avatarUrl: item.avatarUrl || "assets/default-avatar.svg",
        lastMessage: item.lastMessage || "",
        lastMessageAt: item.lastMessageAt || null
      });
      setUnreadCount(item.username, Number(item.unreadCount || 0));
    });
    renderRelations();
    renderThreads();
  } catch (err) {
    console.error(err);
  }
}

function selectConversation(target, options = {}) {
  const receiver = String(target || "").trim();
  if (!receiver || receiver === username) return;
  activeConversation = receiver;
  if (receiverInput) receiverInput.value = receiver;
  updateComposerTargetUi();
  if (messageInput) {
    setTimeout(() => {
      messageInput.focus({ preventScroll: true });
    }, 0);
  }
  pendingUnreadDividerCount = Number(unreadCountsByUser.get(receiver) || 0);
  setUnreadCount(receiver, 0);
  upsertThread(receiver);
  renderRelations();
  renderThreads();
  localStorage.setItem("receiver", receiver);
  socket.emit("joinRoom", getRoom(username, receiver));
  renderPinnedBar();
  if (!options.skipHistory) {
    loadHistory(receiver);
  }
}

function sendMessage(event) {
  if (event) event.preventDefault();

  const receiver = String(activeConversation || (receiverInput && receiverInput.value) || "").trim();
  if (!receiver) {
    showPageAlert("Enter receiver username", "error");
    return;
  }
  selectConversation(receiver, { skipHistory: true });

  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    const selectedFile = fileInput.files[0];
    const isMedia = selectedFile.type && (selectedFile.type.startsWith("image/") || selectedFile.type.startsWith("video/"));
    const maxBytes = 400 * 1024 * 1024;
    if (!isMedia) {
      showPageAlert("Only image or video files are allowed.", "error");
      return;
    }
    if (selectedFile.size > maxBytes) {
      showPageAlert("File exceeds 400 MB limit.", "error");
      return;
    }

    const pending = appendPendingMessage("Uploading media");
    const formData = new FormData();
    formData.append("file", selectedFile);
    (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/upload`, { method: "POST", body: formData })
      : fetch(`${BACKEND_ORIGIN}/upload`, { method: "POST", body: formData }))
      .then((r) => r.json())
      .then((data) => {
        if (!data || !data.fileUrl) throw new Error(data && data.message ? data.message : "Upload failed");
        const sentBubble = appendOwnMessageWithStatus(data.fileUrl, true, "Sending");
        const payload = {
          sender: username,
          receiver,
          message: data.fileUrl,
          room: getRoom(username, receiver),
          isFile: true
        };
        socket.emit("sendMessage", payload, (ack) => {
          if (ack && ack.ok && ack.messageId) {
            attachMessageIdToBubble(sentBubble, ack.messageId);
            setBubbleStatus(sentBubble, "Sent");
            clearBubbleRetryState(sentBubble);
          } else {
            if (isDeletedUserError(ack)) {
              sentBubble.remove();
              removeDeletedUserFromSendTargets(receiver);
              return;
            }
            setBubbleFailedWithRetry(sentBubble, payload);
          }
        });
        upsertThread(receiver, {
          lastMessage: data.fileUrl,
          lastMessageAt: new Date().toISOString()
        });
        setUnreadCount(receiver, 0);
        renderRelations();
        renderThreads();
        pending.remove();
        fileInput.value = "";
        const hint = document.getElementById("fileLabelHint");
        const selectedFileName = document.getElementById("selectedFileName");
        if (hint) hint.textContent = "(none)";
        if (selectedFileName) selectedFileName.textContent = "No file selected.";
        updateSendButtonState();
      })
      .catch((err) => {
        pending.innerHTML = `<strong>${escapeHtml(username)}</strong>: <span style="color:#ff9b9b;font-size:0.76rem;">Failed to send media</span>`;
        console.error(err);
      });
    return;
  }

  const message = String((messageInput && messageInput.value) || "").trim();
  if (!message) return;
  const outgoingMessage = composeReplyMessage(message);

  const sentBubble = appendOwnMessageWithStatus(outgoingMessage, false, "Sending");
  const payload = {
    sender: username,
    receiver,
    message: outgoingMessage,
    room: getRoom(username, receiver),
    isFile: false
  };
  socket.emit("sendMessage", payload, (ack) => {
    if (ack && ack.ok && ack.messageId) {
      attachMessageIdToBubble(sentBubble, ack.messageId);
      setBubbleStatus(sentBubble, "Sent");
      clearBubbleRetryState(sentBubble);
    } else {
      if (isDeletedUserError(ack)) {
        sentBubble.remove();
        removeDeletedUserFromSendTargets(receiver);
        return;
      }
      setBubbleFailedWithRetry(sentBubble, payload);
    }
  });
  upsertThread(receiver, {
    lastMessage: outgoingMessage,
    lastMessageAt: new Date().toISOString()
  });
  setUnreadCount(receiver, 0);
  renderRelations();
  renderThreads();
  if (messageInput) messageInput.value = "";
  clearReplyingState();
}

window.sendMessage = sendMessage;

socket.on("connect", () => {
  socket.emit("userOnline", username);
});

socket.on("receiveMessage", (data) => {
  const sender = String((data && data.sender) || "").trim();
  if (!sender) return;

  upsertThread(sender, {
    lastMessage: data.message || "",
    lastMessageAt: new Date().toISOString()
  });

    if (sender !== activeConversation) {
      if (!mutedUsersSet.has(sender)) incrementUnread(sender, 1);
      renderRelations();
      renderThreads();
      return;
  }

  const bubble = appendMessage(sender, data.message, data.isFile, {
    timeValue: (data && (data.createdAt || data.timestamp || data.updatedAt)) || Date.now(),
    reactions: (data && data.reactions) || []
  });
  if (data && data._id) {
    bubble.dataset.messageId = String(data._id);
    attachMessageMenu(bubble, String(data._id));
  }
  if (data && data._id) {
    socket.emit("messageSeen", { room: getRoom(username, sender), messageId: data._id });
  }
  setUnreadCount(sender, 0);
  renderRelations();
  renderThreads();
});

socket.on("receiveFile", (data) => {
  const sender = String((data && (data.sender || data.from)) || "").trim();
  const fileUrl = data && (data.file || data.message);
  if (!sender) return;
  upsertThread(sender, {
    lastMessage: fileUrl || "",
    lastMessageAt: new Date().toISOString()
  });
  if (sender !== activeConversation) {
    if (!mutedUsersSet.has(sender)) incrementUnread(sender, 1);
    renderRelations();
    renderThreads();
    return;
  }
  const bubble = appendMessage(sender, fileUrl, true, {
    timeValue: (data && (data.createdAt || data.timestamp || data.updatedAt)) || Date.now(),
    reactions: (data && data.reactions) || []
  });
  if (data && data._id) {
    bubble.dataset.messageId = String(data._id);
    attachMessageMenu(bubble, String(data._id));
  }
  setUnreadCount(sender, 0);
  renderRelations();
  renderThreads();
});

socket.on("onlineUsers", (users) => {
  onlineUsersSet = new Set(Array.isArray(users) ? users : []);
  onlineUsersSet.forEach((u) => addKnownUser(u));
  renderRelations();
  renderThreads();
});

socket.on("messageSeenUpdate", (messageId) => {
  const key = String(messageId || "");
  if (!key) return;
  const bubble = outgoingMessageNodes.get(key);
  if (bubble) setBubbleStatus(bubble, "Seen");
});

socket.on("messageDeleted", (data) => {
  if (!data || !data.messageId) return;
  removeMessageBubble(data.messageId);
});

socket.on("messageEdited", (data) => {
  if (!data || !data.messageId || data.message === undefined) return;
  updateMessageBubbleText(data.messageId, data.message);
});

socket.on("messageReactionUpdated", (data) => {
  if (!data || !data.messageId) return;
  applyReactionUpdate(data.messageId, data.reactions || []);
});

if (receiverInput) {
  receiverInput.addEventListener("change", () => {
    const receiver = String(receiverInput.value || "").trim();
    if (!receiver) return;
    selectConversation(receiver);
    updateSendButtonState();
  });

  receiverInput.addEventListener("input", () => {
    updateSendButtonState();
  });
}

if (messageInput) {
  messageInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    sendMessage();
  });

  messageInput.addEventListener("input", () => {
    updateSendButtonState();
    if (!activeConversation) return;
    const now = Date.now();
    if (now - lastTypingEmitAt < TYPING_EMIT_INTERVAL_MS) return;
    lastTypingEmitAt = now;
    socket.emit("typing", { sender: username, room: getRoom(username, activeConversation) });
  });
}

if (sendBtn) {
  sendBtn.addEventListener("click", (event) => {
    sendMessage(event);
  });
}

if (fileInput) {
  fileInput.addEventListener("change", () => {
    updateSendButtonState();
  });
}

socket.on("userTyping", (who) => {
  const typingDiv = document.getElementById("typingStatus");
  if (!typingDiv) return;
  if (!activeConversation || String(who || "") !== String(activeConversation || "")) return;
  if (mutedUsersSet.has(String(who || ""))) return;
  if (typingStatusTimer) clearTimeout(typingStatusTimer);
  typingDiv.innerText = `${who} is typing...`;
  typingStatusTimer = setTimeout(() => {
    typingDiv.innerText = "";
  }, 2000);
});

function loadHistory(receiver) {
  if (!receiver) return;
  (window.APP_CONFIG && window.APP_CONFIG.authFetch
    ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/messages/history/${encodeURIComponent(username)}/${encodeURIComponent(receiver)}`)
    : fetch(`${BACKEND_ORIGIN}/api/messages/history/${encodeURIComponent(username)}/${encodeURIComponent(receiver)}`))
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isDeletedUserError(data)) removeDeletedUserFromSendTargets(receiver);
        throw new Error((data && data.message) || "Failed to load chat history");
      }
      return data;
    })
    .then((messages) => {
      chatBox.innerHTML = "";
      outgoingMessageNodes.clear();
      (Array.isArray(messages) ? messages : []).forEach((m) => {
        const bubble = appendMessage(m.sender, m.message, m.isFile, {
          timeValue: (m && (m.createdAt || m.timestamp || m.updatedAt)) || Date.now(),
          reactions: (m && m.reactions) || []
        });
        if (m && m._id) {
          bubble.dataset.messageId = String(m._id);
          attachMessageMenu(bubble, String(m._id));
          if (m.sender === receiver) {
            socket.emit("messageSeen", { room: getRoom(username, receiver), messageId: m._id });
          }
        }
      });
      setUnreadCount(receiver, 0);
      renderRelations();
      loadThreads();
      if (pendingUnreadDividerCount > 0) {
        const all = Array.from(chatBox.querySelectorAll(".chat-msg"));
        if (all.length > pendingUnreadDividerCount && pendingUnreadDividerCount < all.length) {
          const marker = document.createElement("div");
          marker.className = "msg-pending";
          marker.textContent = "New messages";
          const idx = Math.max(0, all.length - pendingUnreadDividerCount);
          if (all[idx]) {
            chatBox.insertBefore(marker, all[idx]);
          }
        }
      }
      pendingUnreadDividerCount = 0;
      renderPinnedBar();
    })
    .catch((err) => console.error(err));
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    if (window.APP_CONFIG && window.APP_CONFIG.clearSession) {
      window.APP_CONFIG.clearSession();
    } else {
      localStorage.removeItem("username");
      localStorage.removeItem("userId");
      localStorage.removeItem("userRole");
      localStorage.removeItem("authToken");
    }
    window.location.href = "login.html";
  });
}

function bindRelationClick(container) {
  if (!container) return;
  container.addEventListener("click", (event) => {
    const item = event.target.closest("[data-username]");
    if (!item) return;
    const target = item.getAttribute("data-username");
    if (target) selectConversation(target);
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest("[data-username]");
    if (!item) return;
    event.preventDefault();
    const target = item.getAttribute("data-username");
    if (target) selectConversation(target);
  });
}

bindRelationClick(followersListEl);
bindRelationClick(followingListEl);

if (threadsListEl) {
  threadsListEl.addEventListener("click", (event) => {
    const pinBtn = event.target.closest("[data-pin-thread]");
    if (pinBtn) {
      event.preventDefault();
      event.stopPropagation();
      const target = pinBtn.getAttribute("data-pin-thread");
      togglePinnedThread(target);
      return;
    }
    const row = event.target.closest("[data-thread-user]");
    if (!row) return;
    const target = row.getAttribute("data-thread-user");
    if (target) selectConversation(target);
  });

  threadsListEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-thread-user]");
    if (!row) return;
    event.preventDefault();
    const target = row.getAttribute("data-thread-user");
    if (target) selectConversation(target);
  });
}

chatBox.addEventListener("click", async (event) => {
  const retryBtn = event.target.closest("[data-retry-send]");
  if (retryBtn) {
    const bubble = retryBtn.closest(".chat-msg");
    if (!bubble) return;
    const encoded = String(bubble.dataset.retryPayload || "");
    if (!encoded) return;
    let payload = null;
    try {
      payload = JSON.parse(decodeURIComponent(encoded));
    } catch (err) {
      showPageAlert("Retry payload is invalid.", "error");
      return;
    }
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying...";
    setBubbleStatus(bubble, "Sending");
    socket.emit("sendMessage", payload, (ack) => {
      retryBtn.disabled = false;
      if (ack && ack.ok && ack.messageId) {
        attachMessageIdToBubble(bubble, ack.messageId);
        setBubbleStatus(bubble, "Sent");
        clearBubbleRetryState(bubble);
      } else {
        if (isDeletedUserError(ack)) {
          bubble.remove();
          removeDeletedUserFromSendTargets(String((payload && payload.receiver) || ""));
          return;
        }
        setBubbleFailedWithRetry(bubble, payload);
      }
    });
    closeAllMessageMenus();
    return;
  }

  const replyTargetBtn = event.target.closest("[data-reply-target]");
  if (replyTargetBtn) {
    const targetId = String(replyTargetBtn.getAttribute("data-reply-target") || "");
    if (!targetId) return;
    const node = chatBox.querySelector(`[data-message-id="${escapeCssSelector(targetId)}"]`);
    if (!node) {
      showPageAlert("Original message is not loaded in this chat.", "info");
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("pinned-message");
    setTimeout(() => node.classList.remove("pinned-message"), 1500);
    closeAllMessageMenus();
    return;
  }

  const toggleBtn = event.target.closest(".msg-menu-btn");
  if (toggleBtn) {
    const panel = toggleBtn.parentElement ? toggleBtn.parentElement.querySelector(".msg-menu-panel") : null;
    if (!panel) return;
    const open = panel.classList.contains("show");
    closeAllMessageMenus();
    if (!open) panel.classList.add("show");
    return;
  }

  const replyBtn = event.target.closest("[data-reply-message]");
  if (replyBtn) {
    const bubble = replyBtn.closest(".chat-msg");
    if (!bubble) return;
    setReplyingState({
      messageId: replyBtn.getAttribute("data-reply-message") || "",
      sender: bubble.dataset.sender || "user",
      preview: String(bubble.dataset.messageText || "").trim().slice(0, 120)
    });
    if (messageInput) messageInput.focus();
    closeAllMessageMenus();
    return;
  }

  const reactBtn = event.target.closest("[data-react-message]");
  if (reactBtn) {
    const messageId = reactBtn.getAttribute("data-react-message");
    const receiver = activeConversation || (receiverInput && receiverInput.value) || localStorage.getItem("receiver") || "";
    if (!messageId || !receiver) return;
    const picked = prompt("React with emoji (example: 👍, ❤️, 😂)", "👍");
    if (picked === null) return;
    const emoji = String(picked || "").trim().slice(0, 16);
    if (!emoji) return;
    reactBtn.disabled = true;
    socket.emit("reactMessage", {
      messageId,
      emoji,
      room: getRoom(username, receiver)
    }, (ack) => {
      reactBtn.disabled = false;
      if (!(ack && ack.ok)) {
        showPageAlert((ack && ack.error) || "Could not react to message", "error");
      }
    });
    closeAllMessageMenus();
    return;
  }

  const pinBtn = event.target.closest("[data-pin-message]");
  if (pinBtn) {
    const messageId = pinBtn.getAttribute("data-pin-message");
    const bubble = pinBtn.closest(".chat-msg");
    if (!messageId || !bubble) return;
    const key = getConversationKey(activeConversation);
    const pinned = key ? pinnedByConversation[key] : null;
    if (pinned && String(pinned.messageId || "") === String(messageId)) {
      clearPinnedMessageForActiveConversation();
    } else {
      const preview = String(bubble.dataset.messageText || "").trim() || "Message";
      setPinnedMessage(messageId, preview);
    }
    closeAllMessageMenus();
    return;
  }

  const editBtn = event.target.closest("[data-edit-message]");
  if (editBtn) {
    const messageId = editBtn.getAttribute("data-edit-message");
    const bubble = editBtn.closest(".chat-msg");
    const receiver = activeConversation || (receiverInput && receiverInput.value) || localStorage.getItem("receiver") || "";
    if (!messageId || !bubble || !receiver) return;
    const currentText = String(bubble.dataset.messageText || "");
    const nextText = prompt("Edit message:", currentText);
    if (nextText === null) return;
    const trimmed = String(nextText).trim();
    if (!trimmed || trimmed === currentText) return;

    editBtn.disabled = true;
    socket.emit("editMessage", {
      messageId,
      room: getRoom(username, receiver),
      message: trimmed
    }, (ack) => {
      editBtn.disabled = false;
      if (ack && ack.ok) {
        updateMessageBubbleText(messageId, trimmed);
      } else {
        showPageAlert((ack && ack.error) || "Could not edit message", "error");
      }
    });
    closeAllMessageMenus();
    return;
  }

  const deleteBtn = event.target.closest("[data-delete-message]");
  if (deleteBtn) {
    const messageId = deleteBtn.getAttribute("data-delete-message");
    const receiver = activeConversation || (receiverInput && receiverInput.value) || localStorage.getItem("receiver") || "";
    if (!messageId || !receiver) return;
    const confirmed = await askPageConfirm("Delete this message?");
    if (!confirmed) return;

    deleteBtn.disabled = true;
    socket.emit("deleteMessage", {
      messageId,
      requester: username,
      room: getRoom(username, receiver)
    }, (ack) => {
      if (ack && ack.ok) {
        removeMessageBubble(messageId);
      } else {
        deleteBtn.disabled = false;
        showPageAlert((ack && ack.error) || "Could not delete message", "error");
      }
    });
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".msg-menu-wrap")) return;
  closeAllMessageMenus();
});

if (jumpPinnedBtn) {
  jumpPinnedBtn.addEventListener("click", () => {
    const key = getConversationKey(activeConversation);
    const pinned = key ? pinnedByConversation[key] : null;
    if (!pinned || !pinned.messageId) return;
    const node = chatBox.querySelector(`[data-message-id="${escapeCssSelector(pinned.messageId)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("pinned-message");
  });
}

if (clearPinnedBtn) {
  clearPinnedBtn.addEventListener("click", () => {
    clearPinnedMessageForActiveConversation();
  });
}

if (clearReplyingBtn) {
  clearReplyingBtn.addEventListener("click", () => clearReplyingState());
}

if (muteConversationBtn) {
  muteConversationBtn.addEventListener("click", async () => {
    if (!activeConversation) return;
    const target = String(activeConversation || "");
    if (!target) return;
    if (mutedUsersSet.has(target)) mutedUsersSet.delete(target);
    else mutedUsersSet.add(target);
    saveMutedUsersState();
    updateComposerTargetUi();
    renderThreads();
    try {
      await (window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/users/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mutedUsers: Array.from(mutedUsersSet) })
          })
        : fetch(`${BACKEND_ORIGIN}/api/users/settings`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              
            },
            body: JSON.stringify({ mutedUsers: Array.from(mutedUsersSet) })
          }));
    } catch (err) {}
  });
}

if (threadFilterAllBtn) {
  threadFilterAllBtn.addEventListener("click", () => setActiveThreadFilter("all"));
}
if (threadFilterUnreadBtn) {
  threadFilterUnreadBtn.addEventListener("click", () => setActiveThreadFilter("unread"));
}
if (threadFilterMutedBtn) {
  threadFilterMutedBtn.addEventListener("click", () => setActiveThreadFilter("muted"));
}

if (!(window.APP_CONFIG && window.APP_CONFIG.requireAuth && window.APP_CONFIG.requireAuth())) {
  // redirected by requireAuth
} else {
  addKnownUser(username);
  loadMutedUsersState();
  loadPinnedThreadState();
  syncMutedUsersFromServer().then(() => {
    updateComposerTargetUi();
    renderThreads();
  });
  loadPinnedState();
  syncPinnedStateFromServer();
  const usernameDisplay = document.getElementById("usernameDisplay");
  if (usernameDisplay) {
    const raw = localStorage.getItem(`profile_${username}`);
    let profile = null;
    if (raw) {
      try {
        profile = JSON.parse(raw);
      } catch (err) {
        profile = null;
      }
    }
    usernameDisplay.innerText = profile && profile.name ? profile.name : username;
  }

  const savedReceiver = localStorage.getItem("receiver");
  updateComposerTargetUi();
  updateSendButtonState();
  Promise.all([loadRelations(), loadBlockedUsers()]).then(() => {
    renderRelations();
    renderThreads();
    return loadThreads();
  }).then(() => {
    if (savedReceiver) {
      selectConversation(savedReceiver);
      return;
    }
    const sortedThreads = Array.from(threadsByUser.values()).sort((a, b) => {
      const ap = pinnedThreadUsersSet.has(String((a && a.username) || "")) ? 1 : 0;
      const bp = pinnedThreadUsersSet.has(String((b && b.username) || "")) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ta = new Date(a && a.lastMessageAt ? a.lastMessageAt : 0).getTime();
      const tb = new Date(b && b.lastMessageAt ? b.lastMessageAt : 0).getTime();
      return tb - ta;
    });
    const firstThreadUser = sortedThreads.length ? String(sortedThreads[0].username || "") : "";
    if (firstThreadUser && firstThreadUser !== username) {
      selectConversation(firstThreadUser);
      return;
    }
    const firstRelation = [...(profileRelations.followers || []), ...(profileRelations.following || [])]
      .map((u) => String((u && u.username) || ""))
      .find((u) => !!u && u !== username);
    if (firstRelation) {
      selectConversation(firstRelation);
      return;
    }
    renderPinnedBar();
    updateSendButtonState();
  });
}

