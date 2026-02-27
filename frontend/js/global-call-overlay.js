(function () {
  if (window.__ASCAPDX_GLOBAL_CALL_OVERLAY_INIT) return;
  window.__ASCAPDX_GLOBAL_CALL_OVERLAY_INIT = true;

  const app = window.APP_CONFIG || null;
  if (!app || typeof app.getSession !== "function") return;
  const session = app.getSession();
  const username = String((session && session.username) || "");
  const userId = String((session && session.userId) || "");
  if (!username || !userId) return;

  const path = String(window.location.pathname || "").toLowerCase();
  if (path.endsWith("/video-call.html") || path.endsWith("/voice-call.html")) return;

  const backendOrigin = String(app.backendOrigin || "http://localhost:5000");
  const STORAGE_KEY = "ascapdx_pending_call_offer";

  function ensureStyles() {
    if (document.getElementById("ascapdx-call-overlay-style")) return;
    const style = document.createElement("style");
    style.id = "ascapdx-call-overlay-style";
    style.textContent = `
      .ascapdx-call-overlay {
        position: fixed;
        right: 16px;
        bottom: 18px;
        z-index: 9999;
        width: min(360px, calc(100vw - 24px));
        border: 1px solid rgba(153, 197, 244, 0.35);
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(9,24,41,.95), rgba(14,39,64,.92));
        box-shadow: 0 14px 36px rgba(2, 10, 20, 0.5);
        color: #eaf5ff;
        padding: 0.72rem 0.75rem;
        display: none;
      }
      .ascapdx-call-overlay.show { display: block; }
      .ascapdx-call-title { font-weight: 700; margin-bottom: 0.3rem; }
      .ascapdx-call-meta { color: #a9c8e8; font-size: 0.86rem; margin-bottom: 0.55rem; }
      .ascapdx-call-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem; }
      .ascapdx-call-btn {
        border: 1px solid rgba(153, 197, 244, 0.35);
        border-radius: 10px;
        min-height: 2.2rem;
        background: rgba(22, 61, 97, 0.38);
        color: #e8f4ff;
        font-weight: 700;
        cursor: pointer;
      }
      .ascapdx-call-btn.answer {
        border-color: rgba(99, 228, 178, 0.6);
        background: linear-gradient(120deg, #42d1ff, #4ef2cc);
        color: #042033;
      }
      .ascapdx-call-btn.reject {
        border-color: rgba(255, 145, 145, 0.55);
        background: rgba(141, 54, 54, 0.42);
        color: #ffdede;
      }
    `;
    document.head.appendChild(style);
  }

  function createOverlay() {
    ensureStyles();
    const root = document.createElement("div");
    root.className = "ascapdx-call-overlay";
    root.innerHTML = `
      <div class="ascapdx-call-title" id="ascapdxCallTitle">Incoming call</div>
      <div class="ascapdx-call-meta" id="ascapdxCallMeta">Someone is calling...</div>
      <div class="ascapdx-call-actions">
        <button type="button" class="ascapdx-call-btn answer" id="ascapdxCallAnswer">Answer</button>
        <button type="button" class="ascapdx-call-btn reject" id="ascapdxCallReject">Decline</button>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function ensureSocketIo() {
    return new Promise((resolve, reject) => {
      if (window.io) return resolve();
      const existing = document.querySelector("script[src*='socket.io']");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Socket script failed")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.socket.io/4.8.1/socket.io.min.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Socket script failed"));
      document.head.appendChild(script);
    });
  }

  function start() {
    const overlay = createOverlay();
    const titleEl = overlay.querySelector("#ascapdxCallTitle");
    const metaEl = overlay.querySelector("#ascapdxCallMeta");
    const answerBtn = overlay.querySelector("#ascapdxCallAnswer");
    const rejectBtn = overlay.querySelector("#ascapdxCallReject");

    const socket = window.io(backendOrigin, (app && typeof app.getSocketOptions === "function" && app.getSocketOptions()) || { withCredentials: true });
    window.__ASCAPDX_GLOBAL_CALL_SOCKET = socket;
    let pending = null;

    function showIncoming(payload) {
      pending = payload || null;
      const from = String((payload && payload.from) || "");
      const callType = String((payload && payload.callType) || "voice").toLowerCase() === "video" ? "video" : "voice";
      if (titleEl) titleEl.textContent = callType === "video" ? "Incoming video call" : "Incoming voice call";
      metaEl.textContent = from ? `@${from} is calling you.` : "Someone is calling you.";
      overlay.classList.add("show");
    }

    function hideIncoming() {
      pending = null;
      overlay.classList.remove("show");
    }

    socket.on("connect", () => {
      socket.emit("userOnline", username);
    });

    socket.on("voice:call-offer", (payload) => {
      if (!payload || !payload.from || !payload.offer) return;
      showIncoming(payload);
    });

    socket.on("voice:call-reject", (payload) => {
      if (!pending) return;
      const from = String((payload && payload.from) || "");
      if (from && pending.from && from === pending.from) hideIncoming();
    });

    socket.on("voice:hangup", (payload) => {
      if (!pending) return;
      const from = String((payload && payload.from) || "");
      if (from && pending.from && from === pending.from) hideIncoming();
    });

    answerBtn.addEventListener("click", () => {
      if (!pending || !pending.from || !pending.offer) return;
      const payload = {
        from: String(pending.from),
        offer: pending.offer,
        callType: String((pending && pending.callType) || "voice").toLowerCase() === "video" ? "video" : "voice",
        autoAnswer: true,
        createdAt: Date.now()
      };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {}
      const isVideo = payload.callType === "video";
      const nextPage = isVideo ? "video-call.html" : "voice-call.html";
      const nextUrl = `${nextPage}?u=${encodeURIComponent(String(pending.from))}&incoming=1`;
      window.location.href = nextUrl;
    });

    rejectBtn.addEventListener("click", () => {
      if (!pending || !pending.from) return;
      socket.emit("voice:call-reject", {
        from: username,
        to: String(pending.from),
        reason: "rejected"
      });
      hideIncoming();
    });
  }

  ensureSocketIo().then(start).catch(() => {});
})();
