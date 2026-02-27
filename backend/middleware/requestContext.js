const crypto = require("crypto");
const logger = require("../utils/logger");

function sanitizeRequestId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.length > 128) return "";
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return "";
  return value;
}

function getRequestIp(req) {
  const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
  const firstForwarded = forwarded.split(",")[0].trim();
  return String(firstForwarded || req.ip || (req.socket && req.socket.remoteAddress) || "unknown");
}

function requestContext(req, res, next) {
  const incomingId = sanitizeRequestId(req.headers && req.headers["x-request-id"]);
  const requestId = incomingId || crypto.randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  req.log = {
    info(message, meta) {
      logger.info(message, { requestId, ...meta });
    },
    warn(message, meta) {
      logger.warn(message, { requestId, ...meta });
    },
    error(message, meta) {
      logger.error(message, { requestId, ...meta });
    }
  };
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const isAuthorized = !!(req && req.auth && req.auth.userId);
    logger.info("http_request", {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: getRequestIp(req),
      authStatus: isAuthorized ? "authorized" : "unauthorized",
      userId: req && req.auth && req.auth.userId ? String(req.auth.userId) : undefined,
      username: req && req.auth && req.auth.username ? String(req.auth.username) : undefined
    });
  });

  next();
}

module.exports = {
  requestContext
};
