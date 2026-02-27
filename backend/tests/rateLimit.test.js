const test = require("node:test");
const assert = require("node:assert/strict");
const { makeRateLimiter } = require("../middleware/rateLimit");

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("rate limiter allows requests under limit", () => {
  const limiter = makeRateLimiter({ windowMs: 1000, max: 2 });
  const req = { ip: "127.0.0.1" };
  const res = createRes();

  let nextCalls = 0;
  limiter(req, res, () => { nextCalls += 1; });
  limiter(req, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test("rate limiter blocks requests over limit", () => {
  const limiter = makeRateLimiter({ windowMs: 1000, max: 1, message: "Too many requests" });
  const req = { ip: "127.0.0.1" };
  const res = createRes();

  limiter(req, res, () => {});
  limiter(req, res, () => {});

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { message: "Too many requests" });
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
});
