const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-with-32-characters-min";
process.env.NODE_ENV = "test";

const User = require("../models/User");
const EmailOtp = require("../models/EmailOtp");
const { createTestApp } = require("./helpers/testApp");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("./helpers/testDb");

const app = createTestApp();

test.before(async () => {
  await connectTestDb();
});

test.after(async () => {
  await disconnectTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test("cookie auth requires csrf header for mutating requests and allows with valid token", async () => {
  const user = await User.create({
    username: "csrf_user",
    email: "csrf-user@example.com",
    password: "Password123!"
  });

  await EmailOtp.create({
    email: user.email,
    purpose: "login",
    userId: user._id,
    codeHash: await bcrypt.hash("123456", 10),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    verifiedAt: null
  });

  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/auth/login/verify-otp")
    .send({ email: user.email, otp: "123456" });
  assert.equal(loginRes.status, 200);

  const blockedRes = await agent
    .put("/api/users/settings")
    .send({ privacySettings: { accountVisibility: "private" } });
  assert.equal(blockedRes.status, 403);
  assert.equal(blockedRes.body.message, "CSRF validation failed");

  const csrfRes = await agent.get("/api/auth/csrf");
  assert.equal(csrfRes.status, 200);
  const csrfToken = String((csrfRes.body && csrfRes.body.csrfToken) || "");
  assert.ok(csrfToken.length > 10);

  const allowedRes = await agent
    .put("/api/users/settings")
    .set("X-CSRF-Token", csrfToken)
    .send({ privacySettings: { accountVisibility: "private" } });
  assert.equal(allowedRes.status, 200);
});

