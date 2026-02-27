const { requireAuth } = require("./auth");

function getAdminUsernames() {
  const raw = String(process.env.ADMIN_USERNAMES || "").trim();
  const envList = raw
    ? raw.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  return new Set(envList);
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (String(req.auth && req.auth.role) === "admin") {
      return next();
    }
    const admins = getAdminUsernames();
    const username = String(req.auth && req.auth.username);
    if (!admins.size || !admins.has(username)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    return next();
  });
}

module.exports = {
  getAdminUsernames,
  requireAdmin
};
