(function () {
  const session = (window.APP_CONFIG && window.APP_CONFIG.getSession && window.APP_CONFIG.getSession()) || null;
  const username = session ? session.username : "";
  const userId = session ? session.userId : "";
  if (!username || !userId) return;

  const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
  const BADGE_SELECTOR = ".js-missed-call-badge";
  const seenKey = `missed_calls_seen_at_${username}`;

  function updateBadges(count) {
    const badges = document.querySelectorAll(BADGE_SELECTOR);
    badges.forEach((badge) => {
      if (!badge) return;
      if (!count) {
        badge.style.display = "none";
        badge.textContent = "";
        return;
      }
      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.justifyContent = "center";
      badge.style.minWidth = "18px";
      badge.style.height = "18px";
      badge.style.padding = "0 6px";
      badge.style.borderRadius = "999px";
      badge.style.background = "#ff5476";
      badge.style.color = "#fff";
      badge.style.fontSize = "0.7rem";
      badge.style.fontWeight = "700";
      badge.style.lineHeight = "1";
      badge.style.marginLeft = "6px";
      badge.textContent = String(count);
    });
  }

  async function refreshMissedCallBadge() {
    try {
      const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
        ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/calls/history`)
        : fetch(`${BACKEND_ORIGIN}/api/calls/history`));
      if (!res.ok) return;
      const items = await res.json();
      const seenAt = Number(localStorage.getItem(seenKey) || 0);
      const unseenMissed = (Array.isArray(items) ? items : []).filter((item) => {
        if (!item || item.status !== "missed") return false;
        const ts = new Date(item.createdAt || 0).getTime();
        return Number.isFinite(ts) && ts > seenAt;
      });
      updateBadges(unseenMissed.length);
    } catch (err) {
      // silent fail; badge refresh should not block page
    }
  }

  window.refreshMissedCallBadge = refreshMissedCallBadge;

  refreshMissedCallBadge();
  setInterval(refreshMissedCallBadge, 20000);

  window.addEventListener("storage", (event) => {
    if (event.key === seenKey) refreshMissedCallBadge();
  });
  window.addEventListener("missed-calls-updated", refreshMissedCallBadge);
})();
