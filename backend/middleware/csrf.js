const crypto = require("crypto");
const { parseCookieHeader } = require("./auth");

function generateCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function shouldCheckCsrf(method = "GET") {
  const safe = new Set(["GET", "HEAD", "OPTIONS"]);
  return !safe.has(String(method || "").toUpperCase());
}

function requireCsrf(req, res, next) {
  if (!shouldCheckCsrf(req.method)) return next();
  const cookies = parseCookieHeader(req && req.headers ? req.headers.cookie : "");
  const authCookie = String(cookies.auth_token || "").trim();
  if (!authCookie) return next();
  const csrfCookie = String(cookies.csrf_token || "").trim();
  const csrfHeader = String((req && req.headers && req.headers["x-csrf-token"]) || "").trim();
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ message: "CSRF validation failed" });
  }
  return next();
}

module.exports = {
  generateCsrfToken,
  requireCsrf
};
