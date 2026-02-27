let sharedRedisClient = null;
let redisInitAttempted = false;

function getSharedRedisClient() {
  if (sharedRedisClient) return sharedRedisClient;
  if (redisInitAttempted) return null;
  redisInitAttempted = true;
  if (!process.env.REDIS_URL) return null;
  try {
    // Optional distributed limiter support when ioredis is installed.
    // Falls back to memory store automatically when unavailable.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const Redis = require("ioredis");
    sharedRedisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    sharedRedisClient.connect().catch(() => {});
    return sharedRedisClient;
  } catch (err) {
    return null;
  }
}

function makeRateLimiter({
  windowMs = 60 * 1000,
  max = 60,
  message = "Too many requests",
  keyGenerator = null,
  maxEntries = 10000
} = {}) {
  const store = new Map();
  let lastCleanupAt = 0;
  const redisClient = getSharedRedisClient();

  function pruneExpired(now) {
    if (store.size <= maxEntries && (now - lastCleanupAt) < 30 * 1000) return;
    lastCleanupAt = now;
    for (const [key, entry] of store.entries()) {
      if (!entry || entry.resetAt <= now) {
        store.delete(key);
      }
    }
    if (store.size <= maxEntries) return;
    const ordered = Array.from(store.entries()).sort((a, b) => Number((a[1] && a[1].resetAt) || 0) - Number((b[1] && b[1].resetAt) || 0));
    const overflow = store.size - maxEntries;
    for (let i = 0; i < overflow; i += 1) {
      const victim = ordered[i];
      if (!victim) break;
      store.delete(victim[0]);
    }
  }
  function getClientIp(req) {
    const direct = String((req && req.ip) || "").trim();
    if (direct) return direct;
    const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
    const firstForwarded = forwarded.split(",")[0].trim();
    if (firstForwarded) return firstForwarded;
    const remote = String((req && req.socket && req.socket.remoteAddress) || "").trim();
    if (remote) return remote;
    return "unknown";
  }

  return async function rateLimiter(req, res, next) {
    const now = Date.now();
    pruneExpired(now);
    const generated = typeof keyGenerator === "function" ? keyGenerator(req) : "";
    const key = String(generated || getClientIp(req));
    if (redisClient) {
      try {
        const redisKey = `rl:${key}`;
        const count = await redisClient.incr(redisKey);
        if (count === 1) {
          await redisClient.pexpire(redisKey, windowMs);
        }
        if (count > max) {
          const ttlMs = await redisClient.pttl(redisKey);
          const retryAfter = Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000));
          res.setHeader("Retry-After", String(retryAfter));
          return res.status(429).json({ message });
        }
        return next();
      } catch (err) {
        // fall through to in-memory limiter
      }
    }
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message });
    }

    return next();
  };
}

module.exports = {
  makeRateLimiter
};
