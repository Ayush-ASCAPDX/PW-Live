const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-with-32-characters-min";
process.env.NODE_ENV = "test";

const User = require("../models/User");
const Post = require("../models/Post");
const EmailOtp = require("../models/EmailOtp");
const { createTestApp } = require("./helpers/testApp");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("./helpers/testDb");

const app = createTestApp();

function createAuthToken(user, sid = "sid-test-1") {
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

test("auth request-otp creates register OTP entry", async () => {
  const res = await request(app)
    .post("/api/auth/request-otp")
    .send({ email: "new-user@example.com" });

  assert.equal(res.status, 200);
  assert.ok(res.body.message);
  assert.equal(res.body.delivery, "dev-log");

  const otpDoc = await EmailOtp.findOne({ email: "new-user@example.com", purpose: "register" });
  assert.ok(otpDoc);
  assert.ok(String(otpDoc.codeHash || "").startsWith("$2"));
});

test("auth request-otp blocks when email is already registered (case-insensitive)", async () => {
  await User.create({
    username: "existing_user",
    email: "existing-user@example.com",
    password: "Password123!"
  });

  const res = await request(app)
    .post("/api/auth/request-otp")
    .send({ email: "Existing-User@Example.com" });

  assert.equal(res.status, 400);
  assert.equal(res.body.message, "Email already registered");
});

test("auth request-otp enforces 20 OTP emails per address per day across purposes", async () => {
  const email = "daily-cap@example.com";
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  await EmailOtp.create({
    email,
    purpose: "register",
    codeHash: await bcrypt.hash("111111", 10),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    requestDayStart: dayStart,
    requestCountDay: 12,
    lastSentAt: new Date(Date.now() - (2 * 60 * 1000))
  });
  await EmailOtp.create({
    email,
    purpose: "login",
    codeHash: await bcrypt.hash("222222", 10),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    requestDayStart: dayStart,
    requestCountDay: 8,
    lastSentAt: new Date(Date.now() - (2 * 60 * 1000))
  });

  const res = await request(app)
    .post("/api/auth/request-otp")
    .send({ email });

  assert.equal(res.status, 429);
  assert.equal(res.body.message, "Daily OTP email limit reached (20). Try again tomorrow.");
});

test("auth register requires verified OTP first", async () => {
  const email = "register-user@example.com";
  const codeHash = await bcrypt.hash("111111", 10);
  await EmailOtp.create({
    email,
    purpose: "register",
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    verifiedAt: null
  });

  const blocked = await request(app).post("/api/auth/register").send({
    name: "register_user",
    email,
    password: "Password123!"
  });
  assert.equal(blocked.status, 403);

  await EmailOtp.updateOne(
    { email, purpose: "register" },
    { $set: { verifiedAt: new Date() } }
  );

  const allowed = await request(app).post("/api/auth/register").send({
    name: "register_user",
    email,
    password: "Password123!"
  });
  assert.equal(allowed.status, 201);
});

test("auth login verify-otp returns token for valid OTP", async () => {
  const user = await User.create({
    username: "login_user",
    email: "login-user@example.com",
    password: "Password123!"
  });
  const codeHash = await bcrypt.hash("123456", 10);
  await EmailOtp.create({
    email: user.email,
    purpose: "login",
    userId: user._id,
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    verifiedAt: null
  });

  const res = await request(app).post("/api/auth/login/verify-otp").send({
    email: user.email,
    otp: "123456"
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.username, "login_user");
});

test("auth verify-otp invalid attempts are capped and require new OTP", async () => {
  const email = "otp-cap@example.com";
  const codeHash = await bcrypt.hash("123456", 10);
  await EmailOtp.create({
    email,
    purpose: "register",
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    verifiedAt: null,
    attempts: 0
  });

  for (let i = 0; i < 4; i += 1) {
    const bad = await request(app).post("/api/auth/verify-otp").send({ email, otp: "000000" });
    assert.equal(bad.status, 400);
  }

  const capped = await request(app).post("/api/auth/verify-otp").send({ email, otp: "000000" });
  assert.equal(capped.status, 429);

  const gone = await EmailOtp.findOne({ email, purpose: "register" });
  assert.equal(gone, null);
});

test("auth login request-otp locks account after repeated invalid passwords", async () => {
  const email = "lock-user@example.com";
  await User.create({
    username: "lock_user",
    email,
    password: "CorrectPassword123!"
  });

  for (let i = 0; i < 5; i += 1) {
    const bad = await request(app).post("/api/auth/login/request-otp").send({
      email,
      password: "WrongPassword!"
    });
    assert.equal(bad.status, 400);
  }

  const locked = await request(app).post("/api/auth/login/request-otp").send({
    email,
    password: "CorrectPassword123!"
  });
  assert.equal(locked.status, 423);
});

test("posts like endpoint rejects unauthenticated requests", async () => {
  const author = await User.create({
    username: "author_user",
    email: "author@example.com",
    password: "Password123!"
  });

  const post = await Post.create({
    author: author._id,
    authorUsername: author.username,
    authorDisplayName: "Author",
    mediaUrl: "https://cdn.example.com/post.png",
    mediaType: "image",
    caption: "hello",
    privacy: "public"
  });

  const res = await request(app).post(`/api/posts/${post._id}/like`).send({});
  assert.equal(res.status, 401);
});

test("posts like endpoint toggles like for authenticated user", async () => {
  const author = await User.create({
    username: "author_user",
    email: "author@example.com",
    password: "Password123!"
  });
  const viewer = await User.create({
    username: "viewer_user",
    email: "viewer@example.com",
    password: "Password123!",
    sessions: [{ sid: "sid-viewer", userAgent: "test-agent", ip: "127.0.0.1" }]
  });

  const post = await Post.create({
    author: author._id,
    authorUsername: author.username,
    authorDisplayName: "Author",
    mediaUrl: "https://cdn.example.com/post.png",
    mediaType: "image",
    caption: "hello world",
    privacy: "public",
    likes: []
  });

  const token = createAuthToken(viewer, "sid-viewer");

  const likeRes = await request(app)
    .post(`/api/posts/${post._id}/like`)
    .set("Authorization", `Bearer ${token}`)
    .send({});

  assert.equal(likeRes.status, 200);
  assert.equal(likeRes.body.liked, true);
  assert.equal(likeRes.body.likesCount, 1);

  const unlikeRes = await request(app)
    .post(`/api/posts/${post._id}/like`)
    .set("Authorization", `Bearer ${token}`)
    .send({});

  assert.equal(unlikeRes.status, 200);
  assert.equal(unlikeRes.body.liked, false);
  assert.equal(unlikeRes.body.likesCount, 0);
});

test("posts feed hides followers-only posts from non-followers", async () => {
  const author = await User.create({
    username: "author_hidden",
    email: "author-hidden@example.com",
    password: "Password123!"
  });
  await User.create({
    username: "viewer_hidden",
    email: "viewer-hidden@example.com",
    password: "Password123!"
  });

  await Post.create({
    author: author._id,
    authorUsername: author.username,
    authorDisplayName: "Author Hidden",
    mediaUrl: "https://cdn.example.com/post2.png",
    mediaType: "image",
    caption: "followers only",
    privacy: "followers"
  });

  const res = await request(app).get("/api/posts?limit=20");
  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body), true);
  assert.equal(res.body.length, 0);
});
