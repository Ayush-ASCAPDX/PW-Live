const express = require("express");
const router = express.Router();
const User = require("../models/User");
const EmailOtp = require("../models/EmailOtp");
const SecurityEvent = require("../models/SecurityEvent");
const OtpDeliveryEvent = require("../models/OtpDeliveryEvent");
const logger = require("../utils/logger");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  getJwtSecret,
  requireAuth,
  parseAuthHeader,
  parseCookieHeader,
  verifyToken
} = require("../middleware/auth");
const { makeRateLimiter } = require("../middleware/rateLimit");
const { generateCsrfToken } = require("../middleware/csrf");
const { sendMail } = require("../utils/mailer");

const OTP_MAX_VERIFY_ATTEMPTS = 5;
const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const OTP_EMAIL_DAILY_LIMIT = 20;
const OTP_EMAIL_COOLDOWN_MS = 60 * 1000;

function issueToken(user, sid) {
  return jwt.sign(
    { userId: String(user._id), username: String(user.username), sid: String(sid || "") },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findUserByEmail(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return User.findOne({
    email: {
      $regex: `^${escapeRegex(normalized)}$`,
      $options: "i"
    }
  });
}

function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getOtpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

function getStartOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function getClientIp(req) {
  const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
  const firstForwarded = forwarded.split(",")[0].trim();
  return String((req && req.ip) || firstForwarded || (req && req.socket && req.socket.remoteAddress) || "").slice(0, 128);
}

async function logSecurityEvent(req, payload = {}) {
  try {
    await SecurityEvent.create({
      userId: payload.userId || null,
      username: String(payload.username || ""),
      email: normalizeEmail(payload.email || ""),
      type: String(payload.type || "security_event"),
      ip: getClientIp(req),
      userAgent: String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 512),
      meta: (payload.meta && typeof payload.meta === "object") ? payload.meta : {}
    });
  } catch (err) {
    // no-op
  }
}

async function logOtpDelivery(payload = {}) {
  try {
    await OtpDeliveryEvent.create({
      email: normalizeEmail(payload.email || ""),
      purpose: String(payload.purpose || "register"),
      channel: "email",
      delivered: !!payload.delivered,
      provider: String(payload.provider || "smtp"),
      messageId: String(payload.messageId || "").slice(0, 200),
      errorCode: String(payload.errorCode || "").slice(0, 120),
      errorMessage: String(payload.errorMessage || "").slice(0, 400)
    });
  } catch (err) {
    // no-op
  }
}

async function getEmailDailyOtpUsage(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return { todayCount: 0, lastSentAt: null };
  const dayStart = getStartOfTodayUtc().getTime();
  const docs = await EmailOtp.find({ email: normalized }).select("requestDayStart requestCountDay lastSentAt");
  let todayCount = 0;
  let lastSentAt = null;
  docs.forEach((doc) => {
    const docStart = doc && doc.requestDayStart ? new Date(doc.requestDayStart).getTime() : 0;
    if (docStart >= dayStart) {
      todayCount += Number(doc.requestCountDay || 0);
    }
    const sentAt = doc && doc.lastSentAt ? new Date(doc.lastSentAt).getTime() : 0;
    if (sentAt && (!lastSentAt || sentAt > lastSentAt)) {
      lastSentAt = sentAt;
    }
  });
  return { todayCount, lastSentAt: lastSentAt ? new Date(lastSentAt) : null };
}

async function saveOtpForPurpose({ email, purpose, codeHash, userId = null }) {
  const normalized = normalizeEmail(email);
  const now = new Date();
  const todayStart = getStartOfTodayUtc();
  let doc = await EmailOtp.findOne({ email: normalized, purpose });
  if (!doc) {
    doc = new EmailOtp({
      email: normalized,
      purpose
    });
  }
  const currentStart = doc.requestDayStart ? new Date(doc.requestDayStart).getTime() : 0;
  if (!currentStart || currentStart < todayStart.getTime()) {
    doc.requestDayStart = todayStart;
    doc.requestCountDay = 0;
  }
  doc.requestCountDay = Number(doc.requestCountDay || 0) + 1;
  doc.lastSentAt = now;
  doc.codeHash = codeHash;
  doc.expiresAt = getOtpExpiry();
  doc.verifiedAt = null;
  doc.attempts = 0;
  doc.userId = userId || null;
  await doc.save();
}

const otpRequestRateLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "OTP request limit reached (20). Please try again later.",
  keyGenerator: (req) => {
    const email = normalizeEmail(req && req.body ? req.body.email : "");
    const purpose = String((req && req.path) || "").includes("/login/") ? "login" : "register";
    const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
    const firstForwarded = forwarded.split(",")[0].trim();
    const ip = String((req && req.ip) || firstForwarded || (req && req.socket && req.socket.remoteAddress) || "unknown").trim();
    return `${purpose}:${email || "no-email"}:${ip}`;
  }
});

const otpVerifyRateLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  message: "Too many OTP verification attempts. Please try again later.",
  keyGenerator: (req) => {
    const email = normalizeEmail(req && req.body ? req.body.email : "");
    const purpose = String((req && req.path) || "").includes("/login/") ? "login" : "register";
    const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
    const firstForwarded = forwarded.split(",")[0].trim();
    const ip = String((req && req.ip) || firstForwarded || (req && req.socket && req.socket.remoteAddress) || "unknown").trim();
    return `verify:${purpose}:${email || "no-email"}:${ip}`;
  }
});

function buildAuthCookieOptions(req) {
  const isProduction = process.env.NODE_ENV === "production";
  const forwardedProto = String((req && req.headers && req.headers["x-forwarded-proto"]) || "").toLowerCase();
  const isSecureRequest = (req && req.secure) || forwardedProto.includes("https");
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction || !!isSecureRequest,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  };
}

function setAuthCookie(res, req, token) {
  res.cookie("auth_token", token, buildAuthCookieOptions(req));
}

function clearAuthCookie(res) {
  res.clearCookie("auth_token", { httpOnly: true, sameSite: "lax", path: "/" });
}

function createSessionFromRequest(req) {
  const sid = crypto.randomUUID();
  const userAgent = String((req.headers && req.headers["user-agent"]) || "").slice(0, 512);
  const forwarded = String((req.headers && req.headers["x-forwarded-for"]) || "");
  const firstForwardedIp = forwarded.split(",")[0].trim();
  const ip = String(firstForwardedIp || req.ip || "").slice(0, 128);
  const now = new Date();
  return {
    sid,
    label: "",
    userAgent,
    ip,
    createdAt: now,
    lastSeenAt: now
  };
}

function stripSensitiveUser(user) {
  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.failedLoginCount;
  delete userObj.loginLockedUntil;
  return userObj;
}

async function sendOtpEmail(toEmail, otpCode, purpose = "register") {
  const expiresInMinutes = 10;
  const text = [
    "ASCAPDX Security Verification",
    "",
    `Your one-time verification code is: ${otpCode}`,
    "",
    `This code expires in ${expiresInMinutes} minutes.`,
    "If you did not request this code, you can safely ignore this email.",
    "For your security, do not share this code with anyone."
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
      <h2 style="margin: 0 0 12px; font-size: 20px;">ASCAPDX Security Verification</h2>
      <p style="margin: 0 0 12px;">Use the code below to continue:</p>
      <div style="margin: 0 0 14px; padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 8px; display: inline-block; background: #f9fafb;">
        <span style="font-size: 28px; letter-spacing: 4px; font-weight: 700;">${otpCode}</span>
      </div>
      <p style="margin: 0 0 8px;">This code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
      <p style="margin: 0;">If you did not request this code, you can safely ignore this email.</p>
      <p style="margin: 8px 0 0;">For your security, never share this code with anyone.</p>
    </div>
  `;

  try {
    const result = await sendMail({
      to: toEmail,
      subject: "Your ASCAPDX verification code",
      text,
      html
    });
    if (!result || !result.delivered) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log(`[DEV OTP] ${purpose} ${toEmail}: ${otpCode}`);
        logger.info("dev_otp_generated", { email: toEmail, purpose });
      }
      await logOtpDelivery({
        email: toEmail,
        purpose,
        delivered: false,
        provider: (result && result.provider) || "smtp",
        errorCode: (result && result.errorCode) || "DELIVERY_NOT_CONFIRMED",
        errorMessage: "OTP email not delivered"
      });
      return { delivered: false, devOtp: otpCode };
    }
    await logOtpDelivery({
      email: toEmail,
      purpose,
      delivered: true,
      provider: result.provider || "smtp",
      messageId: result.messageId || ""
    });
    return { delivered: true, provider: result.provider || "smtp", messageId: result.messageId || "" };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[DEV OTP] ${purpose} ${toEmail}: ${otpCode}`);
      logger.info("dev_otp_generated", { email: toEmail, purpose });
    }
    await logOtpDelivery({
      email: toEmail,
      purpose,
      delivered: false,
      provider: "smtp",
      errorCode: String((err && err.code) || "SMTP_SEND_FAILED"),
      errorMessage: String((err && err.message) || "OTP email failed")
    });
    if (process.env.NODE_ENV === "production") throw err;
    return { delivered: false, devOtp: otpCode };
  }
}

router.post("/request-otp", otpRequestRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!isValidEmail(email)) return res.status(400).json({ message: "Invalid email" });

    const existing = await findUserByEmail(email).select("_id");
    if (existing) return res.status(400).json({ message: "Email already registered" });

    const usage = await getEmailDailyOtpUsage(email);
    if (usage.todayCount >= OTP_EMAIL_DAILY_LIMIT) {
      return res.status(429).json({ message: "Daily OTP email limit reached (20). Try again tomorrow." });
    }
    if (usage.lastSentAt && (Date.now() - usage.lastSentAt.getTime()) < OTP_EMAIL_COOLDOWN_MS) {
      return res.status(429).json({ message: "Please wait 60 seconds before requesting another OTP." });
    }

    const otpCode = generateOtpCode();
    const codeHash = await bcrypt.hash(otpCode, 10);
    await saveOtpForPurpose({
      email,
      purpose: "register",
      codeHash
    });

    const mail = await sendOtpEmail(email, otpCode, "register");
    const payload = {
      message: "OTP generated",
      delivery: mail && mail.delivered ? "email" : "dev-log"
    };
    if (mail && mail.delivered) {
      payload.message = "OTP has sent to your email";
    } else {
      payload.message = "SMTP is not configured. OTP is available for local testing.";
    }
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Could not send OTP",
      delivery: "failed"
    });
  }
});

router.post("/verify-otp", otpVerifyRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

    const otpDoc = await EmailOtp.findOne({ email, purpose: "register" });
    if (!otpDoc) return res.status(400).json({ message: "OTP not requested" });
    if (otpDoc.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: "OTP expired" });
    const ok = await bcrypt.compare(otp, otpDoc.codeHash);
    if (!ok) {
      otpDoc.attempts += 1;
      if (otpDoc.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        await EmailOtp.deleteOne({ _id: otpDoc._id });
        await logSecurityEvent(req, {
          email,
          type: "otp_verify_failed_limit",
          meta: { purpose: "register" }
        });
        return res.status(429).json({ message: "Too many invalid OTP attempts. Please request a new OTP." });
      }
      await otpDoc.save();
      await logSecurityEvent(req, {
        email,
        type: "otp_verify_failed",
        meta: { purpose: "register", attempts: otpDoc.attempts }
      });
      return res.status(400).json({ message: "Invalid OTP" });
    }

    otpDoc.verifiedAt = new Date();
    otpDoc.attempts = 0;
    await otpDoc.save();
    return res.json({ message: "Email verified" });
  } catch (err) {
    return res.status(500).json({ message: "Could not verify OTP" });
  }
});

// REGISTER (used by frontend/signup.html)
router.post("/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email" });
    }

    const existing = await User.findOne({ $or: [{ email }, { username: name }] });
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    const otpDoc = await EmailOtp.findOne({ email, purpose: "register" }).select("verifiedAt expiresAt");
    if (!otpDoc || !otpDoc.verifiedAt) {
      return res.status(403).json({ message: "Email OTP verification is required" });
    }
    if (!otpDoc.expiresAt || new Date(otpDoc.expiresAt).getTime() < Date.now()) {
      return res.status(403).json({ message: "OTP expired. Please request and verify again." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username: name,
      displayName: name,
      email,
      password: hashedPassword
    });

    await newUser.save();
    await EmailOtp.deleteMany({ email, purpose: "register" });

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    logger.error("register_failed", { requestId: req.requestId, error: err });
    res.status(500).json({ message: "Server error" });
  }
});



// LOGIN
router.post("/login", async (req, res) => {
  return res.status(400).json({
    message: "2FA is enabled. Use /api/auth/login/request-otp then /api/auth/login/verify-otp."
  });
});

router.post("/login/request-otp", otpRequestRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await findUserByEmail(email);
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const lockedUntilTs = user.loginLockedUntil ? new Date(user.loginLockedUntil).getTime() : 0;
    if (lockedUntilTs && lockedUntilTs > Date.now()) {
      await logSecurityEvent(req, {
        userId: user._id,
        username: user.username,
        email: user.email,
        type: "login_locked_attempt"
      });
      return res.status(423).json({ message: "Login temporarily locked. Try again later." });
    }
    if (lockedUntilTs && lockedUntilTs <= Date.now() && (Number(user.failedLoginCount || 0) > 0 || user.loginLockedUntil)) {
      user.failedLoginCount = 0;
      user.loginLockedUntil = null;
      await user.save();
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const failedCount = Number(user.failedLoginCount || 0) + 1;
      user.failedLoginCount = failedCount;
      if (failedCount >= LOGIN_MAX_FAILED_ATTEMPTS) {
        user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
        user.failedLoginCount = 0;
        await logSecurityEvent(req, {
          userId: user._id,
          username: user.username,
          email: user.email,
          type: "login_locked",
          meta: { windowMs: LOGIN_LOCK_MS }
        });
      } else {
        await logSecurityEvent(req, {
          userId: user._id,
          username: user.username,
          email: user.email,
          type: "login_password_failed",
          meta: { failedCount }
        });
      }
      await user.save();
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (Number(user.failedLoginCount || 0) !== 0 || user.loginLockedUntil) {
      user.failedLoginCount = 0;
      user.loginLockedUntil = null;
      await user.save();
    }

    const usage = await getEmailDailyOtpUsage(email);
    if (usage.todayCount >= OTP_EMAIL_DAILY_LIMIT) {
      return res.status(429).json({ message: "Daily OTP email limit reached (20). Try again tomorrow." });
    }
    if (usage.lastSentAt && (Date.now() - usage.lastSentAt.getTime()) < OTP_EMAIL_COOLDOWN_MS) {
      return res.status(429).json({ message: "Please wait 60 seconds before requesting another OTP." });
    }

    const otpCode = generateOtpCode();
    const codeHash = await bcrypt.hash(otpCode, 10);
    await saveOtpForPurpose({
      email,
      purpose: "login",
      codeHash,
      userId: user._id
    });

    const mail = await sendOtpEmail(email, otpCode, "login");
    const payload = {
      message: mail && mail.delivered ? "Login OTP sent to your email" : "SMTP is not configured. OTP is available for local testing.",
      delivery: mail && mail.delivered ? "email" : "dev-log"
    };
    return res.json(payload);
  } catch (err) {
    logger.error("login_request_otp_failed", { requestId: req.requestId, error: err });
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login/verify-otp", otpVerifyRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const otpDoc = await EmailOtp.findOne({ email, purpose: "login" });
    if (!otpDoc) return res.status(400).json({ message: "OTP not requested" });
    if (otpDoc.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: "OTP expired" });
    const ok = await bcrypt.compare(otp, otpDoc.codeHash);
    if (!ok) {
      otpDoc.attempts += 1;
      if (otpDoc.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        await EmailOtp.deleteOne({ _id: otpDoc._id });
        await logSecurityEvent(req, {
          email,
          type: "otp_verify_failed_limit",
          meta: { purpose: "login" }
        });
        return res.status(429).json({ message: "Too many invalid OTP attempts. Please request a new OTP." });
      }
      await otpDoc.save();
      await logSecurityEvent(req, {
        email,
        type: "otp_verify_failed",
        meta: { purpose: "login", attempts: otpDoc.attempts }
      });
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const user = otpDoc.userId
      ? await User.findById(otpDoc.userId)
      : await findUserByEmail(email);
    if (!user) return res.status(404).json({ message: "User not found" });

    otpDoc.verifiedAt = new Date();
    otpDoc.attempts = 0;
    await otpDoc.save();

    const session = createSessionFromRequest(req);
    const existingSessions = Array.isArray(user.sessions) ? user.sessions : [];
    user.sessions = [...existingSessions, session].slice(-20);
    await user.save();
    await EmailOtp.deleteMany({ email, purpose: "login" });

    const token = issueToken(user, session.sid);
    setAuthCookie(res, req, token);
    await logSecurityEvent(req, {
      userId: user._id,
      username: user.username,
      email: user.email,
      type: "login_success",
      meta: { sid: session.sid }
    });
    return res.json({
      message: "Login successful",
      token,
      user: stripSensitiveUser(user)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Could not verify login OTP" });
  }
});

router.post("/logout", requireAuth, async (req, res) => {
  try {
    const sid = String((req.auth && req.auth.sid) || "");
    if (sid) {
      await User.updateOne(
        { _id: req.auth.userId },
        { $pull: { sessions: { sid } } }
      );
    }
    clearAuthCookie(res);
    return res.json({ message: "Logged out" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Logout failed" });
  }
});

router.get("/csrf", async (req, res) => {
  const token = generateCsrfToken();
  const isProduction = process.env.NODE_ENV === "production";
  const forwardedProto = String((req && req.headers && req.headers["x-forwarded-proto"]) || "").toLowerCase();
  const isSecureRequest = (req && req.secure) || forwardedProto.includes("https");
  res.cookie("csrf_token", token, {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction || !!isSecureRequest,
    maxAge: 12 * 60 * 60 * 1000,
    path: "/"
  });
  return res.json({ csrfToken: token });
});

router.post("/password-reset/request-otp", otpRequestRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: "Valid email is required" });
    }

    const user = await findUserByEmail(email).select("_id email username");
    const genericResponse = { message: "If an account exists, OTP has been sent." };
    if (!user) return res.json(genericResponse);

    const usage = await getEmailDailyOtpUsage(email);
    if (usage.todayCount >= OTP_EMAIL_DAILY_LIMIT) {
      return res.status(429).json({ message: "Daily OTP email limit reached (20). Try again tomorrow." });
    }
    if (usage.lastSentAt && (Date.now() - usage.lastSentAt.getTime()) < OTP_EMAIL_COOLDOWN_MS) {
      return res.status(429).json({ message: "Please wait 60 seconds before requesting another OTP." });
    }

    const otpCode = generateOtpCode();
    const codeHash = await bcrypt.hash(otpCode, 10);
    await saveOtpForPurpose({
      email,
      purpose: "password_reset",
      codeHash,
      userId: user._id
    });
    await sendOtpEmail(email, otpCode, "password_reset");
    await logSecurityEvent(req, {
      userId: user._id,
      username: user.username,
      email: user.email,
      type: "password_reset_requested"
    });
    return res.json(genericResponse);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Could not request password reset OTP" });
  }
});

router.post("/password-reset/verify-otp", otpVerifyRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

    const otpDoc = await EmailOtp.findOne({ email, purpose: "password_reset" });
    if (!otpDoc) return res.status(400).json({ message: "OTP not requested" });
    if (otpDoc.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: "OTP expired" });

    const ok = await bcrypt.compare(otp, otpDoc.codeHash);
    if (!ok) {
      otpDoc.attempts += 1;
      if (otpDoc.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        await EmailOtp.deleteOne({ _id: otpDoc._id });
        await logSecurityEvent(req, {
          email,
          type: "otp_verify_failed_limit",
          meta: { purpose: "password_reset" }
        });
        return res.status(429).json({ message: "Too many invalid OTP attempts. Please request a new OTP." });
      }
      await otpDoc.save();
      await logSecurityEvent(req, {
        email,
        type: "otp_verify_failed",
        meta: { purpose: "password_reset", attempts: otpDoc.attempts }
      });
      return res.status(400).json({ message: "Invalid OTP" });
    }

    otpDoc.verifiedAt = new Date();
    otpDoc.attempts = 0;
    await otpDoc.save();
    return res.json({ message: "OTP verified" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Could not verify reset OTP" });
  }
});

router.post("/password-reset/complete", otpVerifyRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const newPassword = String(req.body.newPassword || "");
    if (!email || !newPassword) return res.status(400).json({ message: "Email and newPassword are required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const otpDoc = await EmailOtp.findOne({ email, purpose: "password_reset" }).select("verifiedAt expiresAt userId");
    if (!otpDoc || !otpDoc.verifiedAt) return res.status(403).json({ message: "OTP verification required" });
    if (!otpDoc.expiresAt || new Date(otpDoc.expiresAt).getTime() < Date.now()) {
      return res.status(403).json({ message: "OTP expired. Request a new OTP." });
    }

    const user = otpDoc.userId ? await User.findById(otpDoc.userId) : await findUserByEmail(email);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = newPassword;
    user.sessions = [];
    user.failedLoginCount = 0;
    user.loginLockedUntil = null;
    await user.save();
    await EmailOtp.deleteMany({ email, purpose: "password_reset" });
    clearAuthCookie(res);
    await logSecurityEvent(req, {
      userId: user._id,
      username: user.username,
      email: user.email,
      type: "password_reset_completed"
    });
    return res.json({ message: "Password reset successful" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Could not reset password" });
  }
});

router.get("/session", async (req, res) => {
  try {
    const headerToken = parseAuthHeader(req && req.headers ? req.headers.authorization : "");
    const cookieToken = String(
      (parseCookieHeader(req && req.headers ? req.headers.cookie : "").auth_token) || ""
    ).trim();
    const token = String(headerToken || cookieToken || "").trim();
    if (!token) {
      return res.json({ authenticated: false });
    }

    const decoded = verifyToken(token);
    const userId = String(decoded && decoded.userId ? decoded.userId : "");
    const username = String(decoded && decoded.username ? decoded.username : "");
    const sid = String(decoded && decoded.sid ? decoded.sid : "");
    if (!userId || !username) {
      return res.json({ authenticated: false });
    }

    const user = await User.findById(userId).select("username role sessions");
    if (!user || String(user.username || "") !== username) {
      return res.json({ authenticated: false });
    }

    if (sid) {
      const sessions = Array.isArray(user.sessions) ? user.sessions : [];
      const active = sessions.find((entry) => String((entry && entry.sid) || "") === sid);
      if (!active) {
        return res.json({ authenticated: false });
      }

      const now = Date.now();
      const lastSeenAt = active.lastSeenAt ? new Date(active.lastSeenAt).getTime() : 0;
      if (!Number.isFinite(lastSeenAt) || (now - lastSeenAt) > (5 * 60 * 1000)) {
        await User.updateOne(
          { _id: user._id, "sessions.sid": sid },
          { $set: { "sessions.$.lastSeenAt": new Date(now) } }
        );
      }
    }

    return res.json({
      authenticated: true,
      userId: String(user._id || ""),
      username: String(user.username || ""),
      role: String(user.role || "user")
    });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});


module.exports = router;
