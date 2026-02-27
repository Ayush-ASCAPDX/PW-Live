(function () {
  if (window.UIFeedback) return;

  const style = document.createElement("style");
  style.textContent = `
    .ui-toast-wrap{position:fixed;top:18px;right:18px;z-index:4000;display:grid;gap:10px;max-width:min(92vw,360px)}
    .ui-toast{padding:10px 12px;border-radius:10px;border:1px solid rgba(160,206,255,.28);background:rgba(11,34,63,.94);color:#eaf5ff;font:500 14px/1.35 "Outfit","Manrope",system-ui,sans-serif;box-shadow:0 14px 30px rgba(2,10,20,.35)}
    .ui-toast.success{border-color:rgba(117,228,175,.45);background:rgba(19,77,58,.94);color:#eafff5}
    .ui-toast.error{border-color:rgba(255,140,140,.45);background:rgba(97,30,30,.94);color:#ffeaea}
    .ui-confirm-backdrop{position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:14px}
    .ui-confirm-backdrop.show{display:flex}
    .ui-confirm-card{width:min(92vw,420px);border-radius:12px;border:1px solid rgba(170,208,255,.28);background:#0a1f38;color:#ebf6ff;padding:14px;box-shadow:0 20px 42px rgba(1,7,14,.45)}
    .ui-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
    .ui-confirm-btn{border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;border-radius:9px;padding:6px 12px;cursor:pointer}
    .ui-confirm-btn.danger{border-color:rgba(255,147,147,.5);background:rgba(196,61,61,.64)}
  `;
  document.head.appendChild(style);

  const toastWrap = document.createElement("div");
  toastWrap.className = "ui-toast-wrap";
  document.body.appendChild(toastWrap);

  const confirmBackdrop = document.createElement("div");
  confirmBackdrop.className = "ui-confirm-backdrop";
  confirmBackdrop.innerHTML = `
    <div class="ui-confirm-card" role="dialog" aria-modal="true" aria-live="assertive">
      <div class="ui-confirm-text"></div>
      <div class="ui-confirm-actions">
        <button type="button" class="ui-confirm-btn" data-ui-cancel>Cancel</button>
        <button type="button" class="ui-confirm-btn danger" data-ui-ok>Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmBackdrop);

  const confirmText = confirmBackdrop.querySelector(".ui-confirm-text");
  const confirmOk = confirmBackdrop.querySelector("[data-ui-ok]");
  const confirmCancel = confirmBackdrop.querySelector("[data-ui-cancel]");
  let confirmResolve = null;

  function toast(message, type) {
    const node = document.createElement("div");
    const safeType = type === "success" || type === "error" ? type : "info";
    node.className = `ui-toast ${safeType}`;
    node.textContent = String(message || "");
    toastWrap.appendChild(node);
    window.setTimeout(() => {
      node.remove();
    }, 3200);
  }

  function closeConfirm(result) {
    if (!confirmResolve) return;
    const resolver = confirmResolve;
    confirmResolve = null;
    confirmBackdrop.classList.remove("show");
    resolver(!!result);
  }

  confirmOk.addEventListener("click", () => closeConfirm(true));
  confirmCancel.addEventListener("click", () => closeConfirm(false));
  confirmBackdrop.addEventListener("click", (event) => {
    if (event.target === confirmBackdrop) closeConfirm(false);
  });

  function confirm(message, options) {
    if (confirmResolve) closeConfirm(false);
    confirmText.textContent = String(message || "Are you sure?");
    const tone = options && options.tone === "danger" ? "danger" : "";
    confirmOk.className = `ui-confirm-btn ${tone}`.trim();
    confirmOk.textContent = options && options.okText ? String(options.okText) : "Confirm";
    confirmCancel.textContent = options && options.cancelText ? String(options.cancelText) : "Cancel";
    confirmBackdrop.classList.add("show");
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  window.UIFeedback = { toast, confirm };
})();
