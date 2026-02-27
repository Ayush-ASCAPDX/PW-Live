(function () {
  const LOCOMOTIVE_CSS_URL = "https://cdn.jsdelivr.net/npm/locomotive-scroll@4.1.4/dist/locomotive-scroll.min.css";
  const LOCOMOTIVE_JS_URL = "https://cdn.jsdelivr.net/npm/locomotive-scroll@4.1.4/dist/locomotive-scroll.min.js";

  function applyComfortScroll() {
    const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.style.scrollBehavior = prefersReduced ? "auto" : "smooth";
    if (document.body) {
      document.body.style.scrollBehavior = prefersReduced ? "auto" : "smooth";
    }
  }

  function ensureStyle(href) {
    if (!href) return;
    const exists = Array.from(document.querySelectorAll("link[rel='stylesheet']")).some((node) => String(node.href || "").includes(href));
    if (exists) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function ensureScript(src) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.querySelectorAll("script[src]")).find((node) => String(node.src || "").includes(src));
      if (existing) {
        if (window.LocomotiveScroll) resolve();
        else existing.addEventListener("load", () => resolve(), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load script"));
      document.head.appendChild(script);
    });
  }

  function loadScriptOnce(src) {
    if (!src) return;
    const exists = Array.from(document.querySelectorAll("script[src]")).some((node) => String(node.src || "").includes(src));
    if (exists) return;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  function resolveScrollContainer() {
    const declared = document.querySelector("[data-scroll-container]");
    if (declared) return declared;
    const main = document.querySelector("main");
    if (main) {
      main.setAttribute("data-scroll-container", "");
      return main;
    }
    document.body.setAttribute("data-scroll-container", "");
    return document.body;
  }

  async function initLocomotiveScroll() {
    if (window.__ASCAPDX_LOCO_INIT) return;
    window.__ASCAPDX_LOCO_INIT = true;

    const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      applyComfortScroll();
      return;
    }

    try {
      ensureStyle(LOCOMOTIVE_CSS_URL);
      await ensureScript(LOCOMOTIVE_JS_URL);
      if (!window.LocomotiveScroll) {
        applyComfortScroll();
        return;
      }

      const container = resolveScrollContainer();
      const loco = new window.LocomotiveScroll({
        el: container,
        smooth: true,
        multiplier: 0.95,
        lerp: 0.08,
        smartphone: { smooth: true },
        tablet: { smooth: true }
      });
      window.__ASCAPDX_LOCO = loco;

      window.addEventListener("resize", () => {
        if (window.__ASCAPDX_LOCO && typeof window.__ASCAPDX_LOCO.update === "function") {
          window.__ASCAPDX_LOCO.update();
        }
      });
      window.addEventListener("load", () => {
        if (window.__ASCAPDX_LOCO && typeof window.__ASCAPDX_LOCO.update === "function") {
          window.__ASCAPDX_LOCO.update();
        }
      });
    } catch (err) {
      applyComfortScroll();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applyComfortScroll();
      initLocomotiveScroll();
    }, { once: true });
  } else {
    applyComfortScroll();
    initLocomotiveScroll();
  }

  const rawOrigin = localStorage.getItem("backendOrigin");
  const fallback = "http://localhost:5000";
  const backendOrigin = (rawOrigin && String(rawOrigin).trim()) || fallback;
  let csrfTokenCache = localStorage.getItem("csrfToken") || "";
  const AUTH_TOKEN_KEY = "authToken";
  let restorePromise = null;
  let hasTriggeredRestore = false;

  function getAuthToken() {
    return String(localStorage.getItem(AUTH_TOKEN_KEY) || "").trim();
  }

  function setAuthToken(token) {
    const normalized = String(token || "").trim();
    if (!normalized) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return "";
    }
    localStorage.setItem(AUTH_TOKEN_KEY, normalized);
    return normalized;
  }

  function getSession() {
    return {
      username: localStorage.getItem("username") || "",
      userId: localStorage.getItem("userId") || "",
      role: localStorage.getItem("userRole") || "user"
    };
  }

  function isAuthenticated() {
    const session = getSession();
    return !!(session.username && session.userId);
  }

  async function restoreSessionFromServer() {
    if (restorePromise) return restorePromise;
    restorePromise = fetch(`${backendOrigin}/api/auth/session`, {
      method: "GET",
      headers: authHeaders(),
      credentials: "include"
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        const authenticated = !!(data && data.authenticated);
        if (!authenticated) return null;
        const username = String((data && data.username) || "").trim();
        const userId = String((data && data.userId) || "").trim();
        const role = String((data && data.role) || "user").trim() || "user";
        if (!username || !userId) return null;
        localStorage.setItem("username", username);
        localStorage.setItem("userId", userId);
        localStorage.setItem("userRole", role);
        return { username, userId, role };
      })
      .catch(() => null)
      .finally(() => {
        restorePromise = null;
      });
    return restorePromise;
  }

  function requireAuth(options = {}) {
    const redirectTo = String(options.redirectTo || "login.html");
    const session = getSession();
    if (isAuthenticated()) return session;
    if (hasTriggeredRestore) return null;
    hasTriggeredRestore = true;
    restoreSessionFromServer()
      .then((restored) => {
        if (restored && restored.username && restored.userId) {
          window.location.reload();
          return;
        }
        window.location.href = redirectTo;
      })
      .catch(() => {
        window.location.href = redirectTo;
      });
    return null;
  }

  function clearSession(options = {}) {
    const skipServerLogout = !!(options && options.skipServerLogout);
    if (!skipServerLogout) {
      fetch(`${backendOrigin}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        keepalive: true
      }).catch(() => {});
    }
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    localStorage.removeItem("userRole");
    localStorage.removeItem("csrfToken");
    localStorage.removeItem(AUTH_TOKEN_KEY);
    csrfTokenCache = "";
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const hasAuthHeader = Object.keys(headers).some((key) => String(key).toLowerCase() === "authorization");
    const token = getAuthToken();
    if (!hasAuthHeader && token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function ensureCsrfToken() {
    if (csrfTokenCache) return csrfTokenCache;
    const res = await fetch(`${backendOrigin}/api/auth/csrf`, {
      method: "GET",
      credentials: "include"
    });
    const data = await res.json().catch(() => ({}));
    const token = String((data && data.csrfToken) || "");
    if (!token) return "";
    csrfTokenCache = token;
    localStorage.setItem("csrfToken", token);
    return token;
  }

  function getSocketOptions() {
    const token = getAuthToken();
    const options = {
      withCredentials: true
    };
    if (token) {
      options.auth = { token };
    }
    return options;
  }

  function redirectToLogin(redirectTo = "login.html") {
    const target = String(redirectTo || "login.html");
    const currentPath = String((window.location && window.location.pathname) || "").toLowerCase();
    if (currentPath.endsWith("/login.html") || currentPath.endsWith("/signup.html")) return;
    window.location.href = target;
  }

  function handleUnauthorizedResponse(response, options = {}) {
    if (!response || Number(response.status) !== 401) return false;
    clearSession();
    redirectToLogin(options.redirectTo || "login.html");
    return true;
  }

  function authFetch(input, init = {}) {
    const merged = { ...init };
    merged.headers = authHeaders(init.headers || {});
    merged.credentials = "include";
    const method = String(merged.method || "GET").toUpperCase();
    const needsCsrf = !["GET", "HEAD", "OPTIONS"].includes(method);
    const chain = (needsCsrf ? ensureCsrfToken() : Promise.resolve(""))
      .then((csrfToken) => {
        if (needsCsrf && csrfToken) {
          merged.headers["X-CSRF-Token"] = csrfToken;
        }
        return fetch(input, merged);
      });
    return chain.then((response) => {
      handleUnauthorizedResponse(response, init || {});
      return response;
    });
  }

  function initGlobalCallOverlay() {
    const session = getSession();
    if (!session.username || !session.userId) return;
    ensureCsrfToken().catch(() => {});
    loadScriptOnce("js/global-call-overlay.js");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGlobalCallOverlay, { once: true });
  } else {
    initGlobalCallOverlay();
  }

  function initNavigationGuard() {
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target && event.target.closest
        ? event.target.closest("a[href]")
        : null;
      if (!anchor) return;

      const rawHref = String(anchor.getAttribute("href") || "").trim();
      if (!rawHref) return;
      if (rawHref === "#" || rawHref.toLowerCase().startsWith("javascript:")) {
        event.preventDefault();
        return;
      }
      if (anchor.target && String(anchor.target).toLowerCase() !== "_self") return;

      let nextUrl;
      try {
        nextUrl = new URL(rawHref, window.location.href);
      } catch (err) {
        return;
      }
      if (nextUrl.origin !== window.location.origin) return;

      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (currentPath === nextPath) {
        event.preventDefault();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNavigationGuard, { once: true });
  } else {
    initNavigationGuard();
  }

  window.APP_CONFIG = {
    backendOrigin,
    getSession,
    isAuthenticated,
    requireAuth,
    clearSession,
    getAuthToken,
    setAuthToken,
    redirectToLogin,
    handleUnauthorizedResponse,
    authHeaders,
    ensureCsrfToken,
    getSocketOptions,
    authFetch,
    initLocomotiveScroll,
    initGlobalCallOverlay
  };
})();
