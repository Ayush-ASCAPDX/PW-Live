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

test("e2e auth flow covers register OTP, daily cap, and login lockout", async () => {
  const registerEmail = "flow-user@example.com";

  const otpRequest = await request(app)
    .post("/api/auth/request-otp")
    .send({ email: registerEmail });
  assert.equal(otpRequest.status, 200);

  const registerOtp = await EmailOtp.findOne({ email: registerEmail, purpose: "register" });
  assert.ok(registerOtp);
  registerOtp.codeHash = await bcrypt.hash("123456", 10);
  registerOtp.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  registerOtp.attempts = 0;
  await registerOtp.save();

  const otpVerify = await request(app)
    .post("/api/auth/verify-otp")
    .send({ email: registerEmail, otp: "123456" });
  assert.equal(otpVerify.status, 200);

  const register = await request(app)
    .post("/api/auth/register")
    .send({ name: "flow_user", email: registerEmail, password: "Password123!" });
  assert.equal(register.status, 201);

  const capEmail = "daily-cap-login@example.com";
  await User.create({
    username: "daily_cap_user",
    email: capEmail,
    password: "CorrectPassword123!"
  });
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  await EmailOtp.create([
    {
      email: capEmail,
      purpose: "register",
      codeHash: await bcrypt.hash("111111", 10),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      requestDayStart: dayStart,
      requestCountDay: 12,
      lastSentAt: new Date(Date.now() - (2 * 60 * 1000))
    },
    {
      email: capEmail,
      purpose: "login",
      codeHash: await bcrypt.hash("222222", 10),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      requestDayStart: dayStart,
      requestCountDay: 8,
      lastSentAt: new Date(Date.now() - (2 * 60 * 1000))
    }
  ]);

  const capBlocked = await request(app)
    .post("/api/auth/login/request-otp")
    .send({ email: capEmail, password: "CorrectPassword123!" });
  assert.equal(capBlocked.status, 429);
  assert.equal(capBlocked.body.message, "Daily OTP email limit reached (20). Try again tomorrow.");

  const lockEmail = "lock-flow@example.com";
  await User.create({
    username: "lock_flow_user",
    email: lockEmail,
    password: "CorrectPassword123!"
  });

  for (let i = 0; i < 5; i += 1) {
    const bad = await request(app)
      .post("/api/auth/login/request-otp")
      .send({ email: lockEmail, password: "WrongPassword!" });
    assert.equal(bad.status, 400);
  }

  const locked = await request(app)
    .post("/api/auth/login/request-otp")
    .send({ email: lockEmail, password: "CorrectPassword123!" });
  assert.equal(locked.status, 423);
});
