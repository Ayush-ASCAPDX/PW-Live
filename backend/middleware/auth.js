const jwt = require("jsonwebtoken");
const User = require("../models/User");

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  if (!secret) {
    return "dev-only-jwt-secret-change-me";
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
  return secret;
}

function parseAuthHeader(header = "") {
  const value = String(header || "");
  if (!value.startsWith("Bearer ")) return "";
  return value.slice(7).trim();
}

function parseCookieHeader(cookieHeader = "") {
  const raw = String(cookieHeader || "");
  if (!raw) return {};
  return raw.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx <= 0) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) return acc;
    acc[key] = decodeURIComponent(value || "");
    return acc;
  }, {});
}

function getTokenFromRequest(req) {
  const headerToken = parseAuthHeader(req && req.headers ? req.headers.authorization : "");
  if (headerToken) return headerToken;
  const cookies = parseCookieHeader(req && req.headers ? req.headers.cookie : "");
  return String(cookies.auth_token || "").trim();
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    const decoded = verifyToken(token);

    const userId = String(decoded.userId || "");
    const username = String(decoded.username || "");
    if (!userId || !username) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("username role sessions");
    if (!user || String(user.username || "") !== username) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sid = String(decoded.sid || "");
    if (sid) {
      const sessions = Array.isArray(user.sessions) ? user.sessions : [];
      const active = sessions.find((entry) => String(entry.sid || "") === sid);
      if (!active) {
        return res.status(401).json({ message: "Session expired. Please login again." });
      }

      const now = Date.now();
      const lastSeenAt = active.lastSeenAt ? new Date(active.lastSeenAt).getTime() : 0;
      if (!Number.isFinite(lastSeenAt) || (now - lastSeenAt) > (5 * 60 * 1000)) {
        await User.updateOne(
          { _id: user._id, "sessions.sid": sid },
          { $set: { "sessions.$.lastSeenAt": new Date(now) } }
        );
      }
    }

    req.auth = {
      userId,
      username,
      role: String(user.role || "user"),
      sid
    };

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

module.exports = {
  getJwtSecret,
  parseAuthHeader,
  parseCookieHeader,
  getTokenFromRequest,
  verifyToken,
  requireAuth
};
