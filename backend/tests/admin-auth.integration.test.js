const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-with-32-characters-min";
process.env.NODE_ENV = "test";

const User = require("../models/User");
const SecurityEvent = require("../models/SecurityEvent");
const OtpDeliveryEvent = require("../models/OtpDeliveryEvent");
const { createTestApp } = require("./helpers/testApp");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("./helpers/testDb");

const app = createTestApp();

function createAuthToken(user, sid) {
  return jwt.sign(
    { userId: String(user._id), username: user.username, sid },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

test.before(async () => {
  await connectTestDb();
});

test.after(async () => {
  await disconnectTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test("admin reports endpoint denies non-admin even if username is admin", async () => {
  const user = await User.create({
    username: "admin",
    email: "plain-admin-name@example.com",
    password: "Password123!",
    role: "user",
    sessions: [{ sid: "sid-admin-name", userAgent: "test-agent", ip: "127.0.0.1" }]
  });
  const token = createAuthToken(user, "sid-admin-name");

  const res = await request(app)
    .get("/api/admin/reports")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 403);
});

test("admin reports endpoint allows role-based admin user", async () => {
  const user = await User.create({
    username: "real_admin",
    email: "real-admin@example.com",
    password: "Password123!",
    role: "admin",
    sessions: [{ sid: "sid-real-admin", userAgent: "test-agent", ip: "127.0.0.1" }]
  });
  const token = createAuthToken(user, "sid-real-admin");

  const res = await request(app)
    .get("/api/admin/reports")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body.items), true);
});

test("admin security and telemetry endpoints return data for admin user", async () => {
  const user = await User.create({
    username: "telemetry_admin",
    email: "telemetry-admin@example.com",
    password: "Password123!",
    role: "admin",
    sessions: [{ sid: "sid-telemetry-admin", userAgent: "test-agent", ip: "127.0.0.1" }]
  });
  const token = createAuthToken(user, "sid-telemetry-admin");

  await SecurityEvent.create({
    username: "someone",
    email: "someone@example.com",
    type: "login_locked",
    ip: "127.0.0.1"
  });
  await OtpDeliveryEvent.create({
    email: "someone@example.com",
    purpose: "login",
    delivered: true
  });

  const [eventsRes, lockoutsRes, telemetryRes] = await Promise.all([
    request(app).get("/api/admin/security-events").set("Authorization", `Bearer ${token}`),
    request(app).get("/api/admin/lockouts").set("Authorization", `Bearer ${token}`),
    request(app).get("/api/admin/otp-telemetry").set("Authorization", `Bearer ${token}`)
  ]);

  assert.equal(eventsRes.status, 200);
  assert.equal(Array.isArray(eventsRes.body.items), true);
  assert.equal(lockoutsRes.status, 200);
  assert.equal(Array.isArray(lockoutsRes.body.recent), true);
  assert.equal(telemetryRes.status, 200);
  assert.equal(typeof telemetryRes.body.summary, "object");
});
