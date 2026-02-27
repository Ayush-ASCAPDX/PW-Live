(() => {
  const STYLE_ID = "user-navbar-menu-style";
  const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
  const REFRESH_MS = 30000;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .user-menu-item { position: relative; }
      .user-menu-trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        text-decoration: none;
      }
      .user-menu-trigger .user-menu-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid rgba(162, 211, 255, 0.42);
        box-shadow: 0 0 0 2px rgba(40, 109, 160, 0.26);
      }
      .user-menu-dropdown,
      .user-notif-dropdown {
        position: absolute;
        top: calc(100% + 0.45rem);
        right: 0;
        min-width: 150px;
        padding: 0.35rem;
        border-radius: 12px;
        border: 1px solid rgba(157, 199, 241, 0.25);
        background: rgba(8, 24, 42, 0.96);
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.35);
        display: none;
        z-index: 120;
      }
      .user-menu-dropdown.show,
      .user-notif-dropdown.show { display: block; }
      .user-menu-dropdown button,
      .user-menu-dropdown a {
        width: 100%;
        border: 0;
        background: transparent;
        color: #e8f3ff;
        text-decoration: none;
        text-align: left;
        border-radius: 8px;
        padding: 0.45rem 0.55rem;
        font-size: 0.9rem;
        display: block;
        cursor: pointer;
      }
      .user-menu-dropdown button:hover,
      .user-menu-dropdown a:hover {
        background: rgba(64, 168, 255, 0.2);
      }
      .user-notif-item { position: relative; }
      .user-notif-trigger {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        border-radius: 999px;
      }
      .user-notif-trigger i {
        font-size: 1rem;
        line-height: 1;
      }
      .user-notif-badge {
        position: absolute;
        top: -2px;
        right: -2px;
        min-width: 18px;
        height: 18px;
        border-radius: 999px;
        padding: 0 5px;
        display: none;
        align-items: center;
        justify-content: center;
        background: #ff5c7c;
        color: #fff;
        font-size: 0.68rem;
        font-weight: 700;
        border: 1px solid rgba(255, 255, 255, 0.4);
      }
      .user-notif-badge.show { display: inline-flex; }
      .user-notif-dropdown {
        width: min(360px, 92vw);
        min-width: 300px;
        max-height: min(70vh, 520px);
        overflow: hidden;
        padding: 0.45rem;
      }
      .user-notif-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.35rem 0.35rem 0.45rem;
      }
      .user-notif-head strong {
        color: #f2f8ff;
        font-size: 0.92rem;
      }
      .user-notif-mark-all {
        border: 1px solid rgba(157, 199, 241, 0.3);
        border-radius: 999px;
        background: rgba(33, 99, 156, 0.28);
        color: #def0ff;
        font-size: 0.72rem;
        line-height: 1;
        padding: 0.26rem 0.52rem;
        cursor: pointer;
      }
      .user-notif-list {
        max-height: min(56vh, 420px);
        overflow: auto;
        display: grid;
        gap: 0.32rem;
        padding: 0.1rem;
      }
      .user-notif-foot {
        margin-top: 0.38rem;
        padding-top: 0.35rem;
        border-top: 1px solid rgba(157, 199, 241, 0.18);
      }
      .user-notif-view-all {
        width: 100%;
        display: block;
        text-align: center;
        text-decoration: none;
        border: 1px solid rgba(157, 199, 241, 0.3);
        border-radius: 999px;
        background: rgba(33, 99, 156, 0.28);
        color: #def0ff;
        font-size: 0.75rem;
        line-height: 1.1;
        padding: 0.32rem 0.55rem;
      }
      .user-notif-view-all:hover {
        background: rgba(50, 130, 197, 0.35);
      }
      .user-notif-empty {
        border: 1px dashed rgba(157, 199, 241, 0.25);
        border-radius: 10px;
        color: #aac3df;
        text-align: center;
        padding: 0.9rem 0.55rem;
        font-size: 0.82rem;
      }
      .user-notif-row {
        border: 1px solid rgba(157, 199, 241, 0.22);
        border-radius: 10px;
        background: rgba(11, 30, 53, 0.62);
        padding: 0.45rem 0.5rem;
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 0.45rem;
        cursor: pointer;
      }
      .user-notif-row:hover {
        background: rgba(31, 86, 136, 0.3);
      }
      .user-notif-row.unread {
        border-color: rgba(90, 179, 255, 0.56);
        box-shadow: 0 0 0 1px rgba(54, 161, 252, 0.18) inset;
      }
      .user-notif-icon {
        width: 18px;
        text-align: center;
        color: #9dd2ff;
        font-size: 0.92rem;
        line-height: 1.2rem;
      }
      .user-notif-body {
        min-width: 0;
      }
      .user-notif-text {
        color: #e8f3ff;
        font-size: 0.83rem;
        line-height: 1.3;
        word-break: break-word;
      }
      .user-notif-meta {
        margin-top: 0.2rem;
        color: #9fc3e4;
        font-size: 0.72rem;
      }
    `;
    document.head.appendChild(style);
  }

  function parseSavedProfile(username) {
    if (!username) return null;
    const raw = localStorage.getItem(`profile_${username}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

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

  async function hydrateProfile(username, avatarEl, nameEl, avatarFallback) {
    try {
      const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/users/profile/${encodeURIComponent(username)}`)
        : fetch(`${BACKEND_ORIGIN}/api/users/profile/${encodeURIComponent(username)}`));
      if (!res.ok) return;
      const profile = await res.json();
      localStorage.setItem(`profile_${username}`, JSON.stringify({
        name: profile.name || username,
        bio: profile.bio || "",
        avatarUrl: profile.avatarUrl || ""
      }));
      if (nameEl) nameEl.textContent = profile.name || username;
      if (avatarEl) avatarEl.src = profile.avatarUrl || avatarFallback;
    } catch (err) {
      // keep local fallback
    }
  }

  function mountNotificationsMenu(profileListItem, prefix) {
    const session = (window.APP_CONFIG && window.APP_CONFIG.getSession && window.APP_CONFIG.getSession()) || null;
    const username = session ? session.username : "";
    const userId = session ? session.userId : "";
    if (!username || !userId || !profileListItem || !profileListItem.parentElement) return;

    const host = profileListItem.parentElement;
    if (host.querySelector(".user-notif-item")) return;

    const notifItem = document.createElement("li");
    notifItem.className = "nav-item user-notif-item";
    notifItem.innerHTML = `
      <a class="nav-link user-notif-trigger" href="#" aria-expanded="false" aria-haspopup="true" aria-label="Notifications">
        <i class="bi bi-bell"></i>
        <span class="user-notif-badge" aria-live="polite">0</span>
      </a>
      <div class="user-notif-dropdown" aria-hidden="true">
        <div class="user-notif-head">
          <strong>Notifications</strong>
          <button type="button" class="user-notif-mark-all">Mark all read</button>
        </div>
        <div class="user-notif-list" role="list"></div>
        <div class="user-notif-foot">
          <a class="user-notif-view-all" href="${prefix}notifications.html">View all notifications</a>
        </div>
      </div>
    `;

    host.insertBefore(notifItem, profileListItem);

    const trigger = notifItem.querySelector(".user-notif-trigger");
    const dropdown = notifItem.querySelector(".user-notif-dropdown");
    const badge = notifItem.querySelector(".user-notif-badge");
    const list = notifItem.querySelector(".user-notif-list");
    const markAllBtn = notifItem.querySelector(".user-notif-mark-all");

    let cachedItems = [];
    let refreshTimer = null;

    function closeMenu() {
      dropdown.classList.remove("show");
      dropdown.setAttribute("aria-hidden", "true");
      trigger.setAttribute("aria-expanded", "false");
    }

    function openMenu() {
      dropdown.classList.add("show");
      dropdown.setAttribute("aria-hidden", "false");
      trigger.setAttribute("aria-expanded", "true");
    }

    function updateBadge(unreadCount) {
      const count = Number(unreadCount || 0);
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.classList.add("show");
      } else {
        badge.classList.remove("show");
        badge.textContent = "0";
      }
    }

    function renderItems(items) {
      if (!Array.isArray(items) || !items.length) {
        list.innerHTML = `<div class="user-notif-empty">No notifications yet.</div>`;
        return;
      }

      list.innerHTML = items.map((item) => {
        const icon = iconByType(item.type);
        const unreadClass = item.read ? "" : " unread";
        const text = escapeHtml(item.text || "Notification");
        const when = getRelativeTime(item.createdAt);
        const link = escapeHtml(item.link || "");
        const id = escapeHtml(item.id || "");
        return `
          <article class="user-notif-row${unreadClass}" data-id="${id}" data-link="${link}">
            <i class="bi ${icon} user-notif-icon"></i>
            <div class="user-notif-body">
              <div class="user-notif-text">${text}</div>
              <div class="user-notif-meta">${when}</div>
            </div>
          </article>
        `;
      }).join("");
    }

    async function fetchNotifications() {
      try {
        const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
          ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/notifications?limit=20&grouped=1`)
          : fetch(`${BACKEND_ORIGIN}/api/notifications?limit=20&grouped=1`));
        if (!res.ok) return;
        const data = await res.json();
        cachedItems = Array.isArray(data.items) ? data.items : [];
        updateBadge(data.unreadCount || 0);
        renderItems(cachedItems);
      } catch (err) {
        // keep last successful state
      }
    }

    async function markOneAsRead(id) {
      if (!id) return;
      try {
        await (window.APP_CONFIG && window.APP_CONFIG.authFetch
          ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" })
          : fetch(`${BACKEND_ORIGIN}/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }));
      } catch (err) {
        // ignore
      }
    }

    async function markAllAsRead() {
      try {
        await (window.APP_CONFIG && window.APP_CONFIG.authFetch
          ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/notifications/read-all`, { method: "PATCH" })
          : fetch(`${BACKEND_ORIGIN}/api/notifications/read-all`, { method: "PATCH" }));
      } catch (err) {
        // ignore
      }
      await fetchNotifications();
    }

    trigger.addEventListener("click", async (event) => {
      event.preventDefault();
      if (dropdown.classList.contains("show")) {
        closeMenu();
        return;
      }
      openMenu();
      await fetchNotifications();
    });

    markAllBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      markAllBtn.disabled = true;
      await markAllAsRead();
      markAllBtn.disabled = false;
    });

    list.addEventListener("click", async (event) => {
      const row = event.target.closest(".user-notif-row");
      if (!row) return;
      const id = row.getAttribute("data-id");
      const link = row.getAttribute("data-link");
      const wasUnread = row.classList.contains("unread");
      if (wasUnread) {
        await markOneAsRead(id);
      }
      if (link) {
        const href = link.startsWith("/") ? `${prefix}${link.slice(1)}` : `${prefix}${link}`;
        window.location.href = href;
        return;
      }
      await fetchNotifications();
    });

    document.addEventListener("click", (event) => {
      if (!notifItem.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    window.addEventListener("focus", fetchNotifications);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") fetchNotifications();
    });

    fetchNotifications();
    refreshTimer = setInterval(fetchNotifications, REFRESH_MS);
    window.addEventListener("beforeunload", () => {
      if (refreshTimer) clearInterval(refreshTimer);
    });
  }

  function mountUserMenuForProfileLink(profileLink) {
    const listItem = profileLink.closest("li");
    if (!listItem) return;

    const profileHref = profileLink.getAttribute("href") || "profile.html";
    const prefix = profileHref.startsWith("../") ? "../" : "";
    const loginHref = `${prefix}login.html`;
    const avatarFallback = `${prefix}assets/default-avatar.svg`;

    const session = (window.APP_CONFIG && window.APP_CONFIG.getSession && window.APP_CONFIG.getSession()) || null;
    const username = session ? session.username : "";
    const userId = session ? session.userId : "";

    if (!username || !userId) {
      listItem.innerHTML = `<a class="nav-link" href="${loginHref}">Login / Signup</a>`;
      return;
    }

    mountNotificationsMenu(listItem, prefix);

    const savedProfile = parseSavedProfile(username);
    const displayName = (savedProfile && savedProfile.name) ? savedProfile.name : username;
    const avatarUrl = (savedProfile && savedProfile.avatarUrl) ? savedProfile.avatarUrl : avatarFallback;

    listItem.classList.add("user-menu-item");
    listItem.innerHTML = `
      <a class="nav-link user-menu-trigger" href="#" aria-expanded="false" aria-haspopup="true">
        <img class="user-menu-avatar" src="${avatarUrl}" alt="${displayName} profile">
        <strong class="user-menu-name"></strong>
      </a>
      <div class="user-menu-dropdown" aria-hidden="true">
        <a href="${profileHref}" class="js-menu-profile">Profile</a>
        <a href="${prefix}settings.html" class="js-menu-settings">Settings</a>
        <a href="${prefix}insights.html" class="js-menu-insights">Insights</a>
        <button type="button" class="js-menu-logout">Logout</button>
      </div>
    `;

    const trigger = listItem.querySelector(".user-menu-trigger");
    const dropdown = listItem.querySelector(".user-menu-dropdown");
    const logoutBtn = listItem.querySelector(".js-menu-logout");
    const nameEl = listItem.querySelector(".user-menu-name");
    const avatarEl = listItem.querySelector(".user-menu-avatar");

    if (nameEl) nameEl.textContent = displayName;
    if (avatarEl) {
      avatarEl.onerror = () => {
        avatarEl.src = avatarFallback;
      };
    }

    const closeMenu = () => {
      if (!dropdown || !trigger) return;
      dropdown.classList.remove("show");
      dropdown.setAttribute("aria-hidden", "true");
      trigger.setAttribute("aria-expanded", "false");
    };

    const openMenu = () => {
      if (!dropdown || !trigger) return;
      dropdown.classList.add("show");
      dropdown.setAttribute("aria-hidden", "false");
      trigger.setAttribute("aria-expanded", "true");
    };

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      if (dropdown.classList.contains("show")) closeMenu();
      else openMenu();
    });

    logoutBtn.addEventListener("click", async () => {
      try {
        const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
        const request = (window.APP_CONFIG && window.APP_CONFIG.authFetch) || fetch;
        await request(`${BACKEND_ORIGIN}/api/auth/logout`, { method: "POST" });
      } catch (err) {
        // no-op: fallback to local logout
      }
      if (window.APP_CONFIG && window.APP_CONFIG.clearSession) {
        window.APP_CONFIG.clearSession({ skipServerLogout: true });
      } else {
        localStorage.removeItem("username");
        localStorage.removeItem("userId");
        localStorage.removeItem("userRole");
        localStorage.removeItem("authToken");
      }
      closeMenu();
      window.location.href = loginHref;
    });

    document.addEventListener("click", (event) => {
      if (!listItem.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    hydrateProfile(username, avatarEl, nameEl, avatarFallback);
  }

  function init() {
    injectStyles();
    const profileLinks = document.querySelectorAll('nav a[href="profile.html"], nav a[href="../profile.html"]');
    profileLinks.forEach((link) => mountUserMenuForProfileLink(link));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
