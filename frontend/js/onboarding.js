(function () {
  const session = (window.APP_CONFIG && window.APP_CONFIG.getSession && window.APP_CONFIG.getSession()) || null;
  if (!session || !session.username) return;
  const API = ((window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000") + "/api/users/settings";
  const authFetch = (url, opts = {}) => (window.APP_CONFIG && window.APP_CONFIG.authFetch ? window.APP_CONFIG.authFetch(url, opts) : fetch(url, opts));

  function ensureUi() {
    if (document.getElementById("onboardingOverlay")) return;
    const style = document.createElement("style");
    style.textContent = `
      .onb-overlay{position:fixed;inset:0;z-index:250;background:rgba(2,8,16,.7);display:grid;place-items:center;padding:1rem}
      .onb-card{width:min(520px,96vw);border:1px solid rgba(153,197,244,.28);border-radius:14px;background:rgba(9,24,42,.96);padding:1rem;color:#e8f4ff}
      .onb-actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.8rem}
    `;
    document.head.appendChild(style);
    const div = document.createElement("div");
    div.id = "onboardingOverlay";
    div.className = "onb-overlay";
    div.innerHTML = `
      <div class="onb-card">
        <h3 style="margin:0 0 .45rem;">Welcome to ASCAPDX</h3>
        <p style="margin:0 0 .35rem;">Quick start:</p>
        <ol style="margin:0 0 .3rem;">
          <li>Open Stories at the top.</li>
          <li>Use Feed actions: Like, Comment, Save, Share.</li>
          <li>Chat from the top navigation.</li>
          <li>Manage privacy in Settings.</li>
        </ol>
        <div class="onb-actions">
          <button id="onbSkip" class="btn btn-outline-light btn-sm" type="button">Skip</button>
          <button id="onbDone" class="btn btn-info btn-sm" type="button">Got it</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    const close = async () => {
      div.remove();
      try {
        await authFetch(API, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboardingState: { completed: true, dismissedAt: new Date().toISOString() } })
        });
      } catch (err) {}
    };
    document.getElementById("onbDone").addEventListener("click", close);
    document.getElementById("onbSkip").addEventListener("click", close);
  }

  async function maybeShow() {
    try {
      const res = await authFetch(API);
      const data = await res.json();
      if (!res.ok) return;
      const done = !!(data.onboardingState && data.onboardingState.completed);
      if (!done) ensureUi();
    } catch (err) {}
  }
  maybeShow();
})();
