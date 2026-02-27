(function () {
  function normalizeOrigin(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return url.origin;
    } catch (err) {
      return "";
    }
  }

  function getSiteOrigin() {
    const fromWindow = normalizeOrigin(window.SITE_ORIGIN || "");
    if (fromWindow) return fromWindow;

    const fromStorage = normalizeOrigin(localStorage.getItem("siteOrigin") || "");
    if (fromStorage) return fromStorage;

    return window.location.origin;
  }

  function getPagePath() {
    const bodyPath = document.body ? document.body.getAttribute("data-seo-path") : "";
    if (bodyPath && bodyPath.startsWith("/")) return bodyPath;
    return window.location.pathname || "/";
  }

  function ensureCanonicalLink() {
    let el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", "canonical");
      document.head.appendChild(el);
    }
    return el;
  }

  function ensureMeta(selector, attrName, attrValue) {
    let el = document.querySelector(selector);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attrName, attrValue);
      document.head.appendChild(el);
    }
    return el;
  }

  function initSeoUrls() {
    const origin = getSiteOrigin();
    const path = getPagePath();
    const absoluteUrl = `${origin}${path}`;

    ensureCanonicalLink().setAttribute("href", absoluteUrl);
    ensureMeta('meta[property="og:url"]', "property", "og:url").setAttribute("content", absoluteUrl);
    ensureMeta('meta[name="twitter:url"]', "name", "twitter:url").setAttribute("content", absoluteUrl);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSeoUrls);
  } else {
    initSeoUrls();
  }
})();
