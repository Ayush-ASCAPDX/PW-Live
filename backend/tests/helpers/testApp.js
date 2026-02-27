const express = require("express");

function createTestApp() {
  const app = express();
  app.use(express.json());
  const { requireCsrf } = require("../../middleware/csrf");
  app.use(requireCsrf);

  const authRoutes = require("../../routes/authRoutes");
  const postRoutes = require("../../routes/postRoutes");
  const userRoutes = require("../../routes/userRoutes");
  const notificationRoutes = require("../../routes/notificationRoutes");
  const adminRoutes = require("../../routes/adminRoutes");

  app.use("/api/auth", authRoutes);
  app.use("/api/posts", postRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/admin", adminRoutes);

  return app;
}

module.exports = {
  createTestApp
};
