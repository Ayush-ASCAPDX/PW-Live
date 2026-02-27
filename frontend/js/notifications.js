const session = (window.APP_CONFIG && window.APP_CONFIG.requireAuth && window.APP_CONFIG.requireAuth()) || null;
const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";

const listEl = document.getElementById("notificationsList");
const markAllBtn = document.getElementById("markAllBtn");

function getRelativeTime(dateInput) {
  const time = new Date(dateInput).getTime();
  if (!time) return "just now";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function iconByType(type) {
  if (type === "like") return "bi-heart-fill";
  if (type === "comment") return "bi-chat-square-text-fill";
  if (type === "reply") return "bi-reply-fill";
  if (type === "mention") return "bi-at";
  if (type === "follow") return "bi-person-plus-fill";
  if (type === "follow_request") return "bi-person-plus";
  if (type === "message") return "bi-chat-dots-fill";
  if (type === "call_missed") return "bi-telephone-x-fill";
  if (type === "collection_save") return "bi-collection-fill";
  return "bi-bell-fill";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLink(link) {
  const raw = String(link || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw.slice(1);
  return raw;
}

async function fetchNotifications() {
  const req = (window.APP_CONFIG && window.APP_CONFIG.authFetch)
    ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/notifications?limit=60&grouped=1`)
    : fetch(`${BACKEND_ORIGIN}/api/notifications?limit=60&grouped=1`);
  const res = await req;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Failed to load notifications");
  return Array.isArray(data.items) ? data.items : [];
}

function render(items) {
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = '<p class="empty-line">No notifications yet.</p>';
    return;
  }

  listEl.innerHTML = items.map((item) => {
    const id = escapeHtml(item.id || "");
    const unreadClass = item.read ? "" : " unread";
    const text = escapeHtml(item.text || "Notification");
    const when = getRelativeTime(item.createdAt);
    const icon = iconByType(item.type);
    const link = normalizeLink(item.link);
    const linkHtml = link
      ? `<a class="notif-link" href="${escapeHtml(link)}">Open</a>`
      : "";
    const readBtn = item.read
      ? ""
      : `<button type="button" class="notif-read-btn" data-read-id="${id}">Mark read</button>`;

    return `
      <article class="notif-row${unreadClass}" data-item-id="${id}">
        <i class="bi ${icon} notif-icon"></i>
        <div>
          <p class="notif-text">${text}</p>
          <div class="notif-meta">${when}</div>
        </div>
        <div class="notif-actions">
          ${linkHtml}
          ${readBtn}
        </div>
      </article>
    `;
  }).join("");
}

async function markRead(notificationId) {
  if (!notificationId) return;
  const req = (window.APP_CONFIG && window.APP_CONFIG.authFetch)
    ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" })
    : fetch(`${BACKEND_ORIGIN}/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
  await req;
}

async function markAllRead() {
  const req = (window.APP_CONFIG && window.APP_CONFIG.authFetch)
    ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/notifications/read-all`, { method: "PATCH" })
    : fetch(`${BACKEND_ORIGIN}/api/notifications/read-all`, { method: "PATCH" });
  await req;
}

async function refresh() {
  try {
    const items = await fetchNotifications();
    render(items);
  } catch (err) {
    if (listEl) listEl.innerHTML = `<p class="empty-line">${escapeHtml(err.message || "Failed to load notifications.")}</p>`;
  }
}

if (markAllBtn) {
  markAllBtn.addEventListener("click", async () => {
    markAllBtn.disabled = true;
    try {
      await markAllRead();
      await refresh();
    } finally {
      markAllBtn.disabled = false;
    }
  });
}

if (listEl) {
  listEl.addEventListener("click", async (event) => {
    const readBtn = event.target.closest("[data-read-id]");
    if (!readBtn) return;
    const id = readBtn.getAttribute("data-read-id");
    readBtn.disabled = true;
    try {
      await markRead(id);
      await refresh();
    } finally {
      readBtn.disabled = false;
    }
  });
}

if (session) {
  refresh();
}
