const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-with-32-characters-min";
process.env.NODE_ENV = "test";

const User = require("../models/User");
const Post = require("../models/Post");
const Notification = require("../models/Notification");
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

async function createUserWithSession({ username, email, sid }) {
  const user = await User.create({
    username,
    email,
    password: "Password123!",
    sessions: [{ sid, userAgent: "test-agent", ip: "127.0.0.1" }]
  });
  const token = createAuthToken(user, sid);
  return { user, token };
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

test("users settings get/put persists privacy, notifications, muted users, and pinned chats", async () => {
  const { user, token } = await createUserWithSession({
    username: "settings_user",
    email: "settings@example.com",
    sid: "sid-settings"
  });

  const getBefore = await request(app)
    .get("/api/users/settings")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(getBefore.status, 200);
  assert.equal(getBefore.body.notificationPrefs.like, true);
  assert.equal(getBefore.body.privacySettings.accountVisibility, "public");

  const updatePayload = {
    notificationPrefs: {
      like: false,
      comment: true,
      follow: false,
      message: true,
      call_missed: false
    },
    privacySettings: {
      accountVisibility: "private",
      allowMessagesFrom: "followers",
      allowCallsFrom: "none",
      allowCommentsFrom: "followers"
    },
    mutedUsers: ["noisy_user", "loud_user"],
    pinnedChats: {
      "settings_user__friend_user": { messageId: "abc123", preview: "Pinned hello" }
    }
  };

  const putRes = await request(app)
    .put("/api/users/settings")
    .set("Authorization", `Bearer ${token}`)
    .send(updatePayload);
  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.settings.notificationPrefs.like, false);
  assert.equal(putRes.body.settings.privacySettings.allowCallsFrom, "none");
  assert.deepEqual(putRes.body.settings.mutedUsers, ["noisy_user", "loud_user"]);
  assert.equal(
    putRes.body.settings.pinnedChats["settings_user__friend_user"].messageId,
    "abc123"
  );

  const saved = await User.findById(user._id);
  assert.equal(saved.notificationPrefs.like, false);
  assert.equal(saved.privacySettings.accountVisibility, "private");
  assert.deepEqual(saved.mutedUsers, ["noisy_user", "loud_user"]);
  assert.equal(saved.pinnedChats["settings_user__friend_user"].preview, "Pinned hello");
});

test("change-password keeps only current session", async () => {
  const user = await User.create({
    username: "pwd_user",
    email: "pwd-user@example.com",
    password: "Password123!",
    sessions: [
      { sid: "sid-current", userAgent: "test-agent", ip: "127.0.0.1" },
      { sid: "sid-other", userAgent: "test-agent", ip: "127.0.0.1" }
    ]
  });
  const token = createAuthToken(user, "sid-current");

  const res = await request(app)
    .post("/api/users/change-password")
    .set("Authorization", `Bearer ${token}`)
    .send({
      currentPassword: "Password123!",
      newPassword: "NewPassword123!"
    });

  assert.equal(res.status, 200);
  const updated = await User.findById(user._id).select("sessions password");
  assert.equal(Array.isArray(updated.sessions), true);
  assert.equal(updated.sessions.length, 1);
  assert.equal(String(updated.sessions[0].sid), "sid-current");
  assert.notEqual(String(updated.password || ""), "NewPassword123!");
});

test("session label can be updated for an active session", async () => {
  const { token } = await createUserWithSession({
    username: "session_label_user",
    email: "session-label@example.com",
    sid: "sid-label"
  });

  const patchRes = await request(app)
    .patch("/api/users/sessions/sid-label/label")
    .set("Authorization", `Bearer ${token}`)
    .send({ label: "My Laptop" });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.label, "My Laptop");

  const sessionsRes = await request(app)
    .get("/api/users/sessions")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(sessionsRes.status, 200);
  assert.equal(Array.isArray(sessionsRes.body.items), true);
  assert.equal(sessionsRes.body.items[0].label, "My Laptop");
});

test("bookmark collections create/add/remove/delete flow works", async () => {
  const { token } = await createUserWithSession({
    username: "collector_user",
    email: "collector@example.com",
    sid: "sid-collector"
  });
  const author = await User.create({
    username: "post_author",
    email: "author-collector@example.com",
    password: "Password123!"
  });
  const post = await Post.create({
    author: author._id,
    authorUsername: author.username,
    authorDisplayName: "Post Author",
    mediaUrl: "https://cdn.example.com/p1.jpg",
    mediaType: "image",
    caption: "collect me",
    privacy: "public"
  });

  const createRes = await request(app)
    .post("/api/users/bookmarks/collections")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Favorites" });
  assert.equal(createRes.status, 201);

  const addRes = await request(app)
    .post("/api/users/bookmarks/collections/Favorites/posts")
    .set("Authorization", `Bearer ${token}`)
    .send({ postId: String(post._id) });
  assert.equal(addRes.status, 200);

  const getRes = await request(app)
    .get("/api/users/bookmarks/collections")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.items.length, 1);
  assert.equal(getRes.body.items[0].name, "Favorites");
  assert.equal(getRes.body.items[0].count, 1);
  assert.equal(getRes.body.items[0].postIds[0], String(post._id));

  const removePostRes = await request(app)
    .delete(`/api/users/bookmarks/collections/Favorites/posts/${post._id}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(removePostRes.status, 200);

  const deleteCollectionRes = await request(app)
    .delete("/api/users/bookmarks/collections/Favorites")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(deleteCollectionRes.status, 200);
});

test("notifications endpoint can return grouped items", async () => {
  const { user, token } = await createUserWithSession({
    username: "notify_target",
    email: "notify-target@example.com",
    sid: "sid-notify"
  });

  await Notification.create({
    recipientUsername: user.username,
    actorUsername: "alice",
    type: "comment",
    text: "@alice commented on your post",
    entityType: "post",
    entityId: "post-1",
    link: "/index.html#post-1"
  });
  await Notification.create({
    recipientUsername: user.username,
    actorUsername: "bob",
    type: "comment",
    text: "@bob commented on your post",
    entityType: "post",
    entityId: "post-1",
    link: "/index.html#post-1"
  });
  await Notification.create({
    recipientUsername: user.username,
    actorUsername: "charlie",
    type: "follow",
    text: "@charlie followed you",
    entityType: "user",
    entityId: "charlie",
    link: "/user-profile.html?u=charlie",
    readAt: new Date()
  });

  const res = await request(app)
    .get("/api/notifications?grouped=1&limit=20")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.unreadCount, 2);
  assert.equal(Array.isArray(res.body.items), true);
  assert.equal(res.body.items.length, 2);
  const groupedComment = res.body.items.find((item) => item.type === "comment");
  assert.ok(groupedComment);
  assert.equal(groupedComment.grouped, true);
  assert.equal(groupedComment.count, 2);
});

test("post insights and bulk management endpoints work for owner", async () => {
  const { user, token } = await createUserWithSession({
    username: "post_owner",
    email: "post-owner@example.com",
    sid: "sid-owner"
  });

  const postA = await Post.create({
    author: user._id,
    authorUsername: user.username,
    authorDisplayName: "Post Owner",
    mediaUrl: "https://cdn.example.com/a.jpg",
    mediaType: "image",
    caption: "A",
    privacy: "public",
    likes: ["u1", "u2"],
    comments: [{ username: "u3", text: "nice" }],
    archived: false
  });
  const postB = await Post.create({
    author: user._id,
    authorUsername: user.username,
    authorDisplayName: "Post Owner",
    mediaUrl: "https://cdn.example.com/b.jpg",
    mediaType: "image",
    caption: "B",
    privacy: "public",
    publishAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    archived: true
  });

  const insightsRes = await request(app)
    .get("/api/posts/insights/me")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(insightsRes.status, 200);
  assert.equal(insightsRes.body.totals.posts, 2);
  assert.equal(insightsRes.body.totals.likes, 2);
  assert.equal(insightsRes.body.totals.comments, 1);
  assert.equal(insightsRes.body.totals.archived, 1);
  assert.equal(insightsRes.body.totals.scheduled, 1);

  const archiveRes = await request(app)
    .post("/api/posts/manage/bulk")
    .set("Authorization", `Bearer ${token}`)
    .send({ action: "archive", postIds: [String(postA._id)] });
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveRes.body.affected, 1);

  const afterArchive = await Post.findById(postA._id);
  assert.equal(afterArchive.archived, true);

  const deleteRes = await request(app)
    .post("/api/posts/manage/bulk")
    .set("Authorization", `Bearer ${token}`)
    .send({ action: "delete", postIds: [String(postB._id)] });
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.affected, 1);

  const deleted = await Post.findById(postB._id);
  assert.equal(deleted, null);
});
