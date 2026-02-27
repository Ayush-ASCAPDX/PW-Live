const nodemailer = require("nodemailer");

let cachedTransporter = null;

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const portRaw = Number(process.env.SMTP_PORT || 0);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 0;
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secure = toBool(process.env.SMTP_SECURE, port === 465);
  const fromEmail = String(process.env.FROM_EMAIL || user || "").trim();
  const fromName = String(process.env.FROM_NAME || "ASCAPDX").trim();
  return { host, port, user, pass, secure, fromEmail, fromName };
}

function isSmtpConfigured() {
  const cfg = getSmtpConfig();
  return !!(cfg.host && cfg.port && cfg.user && cfg.pass && cfg.fromEmail);
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const cfg = getSmtpConfig();
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
  return cachedTransporter;
}

function buildFromField() {
  const cfg = getSmtpConfig();
  if (!cfg.fromName) return cfg.fromEmail;
  return `${cfg.fromName} <${cfg.fromEmail}>`;
}

async function sendMail({ to, subject, text, html }) {
  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV === "production") {
      const err = new Error("Email service is not configured");
      err.code = "SMTP_NOT_CONFIGURED";
      throw err;
    }
    return { delivered: false, provider: "smtp", errorCode: "SMTP_NOT_CONFIGURED" };
  }
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: buildFromField(),
    to: String(to || "").trim(),
    subject: String(subject || "").trim(),
    text: String(text || "").trim(),
    html: String(html || "").trim()
  });
  return {
    delivered: true,
    provider: "smtp",
    messageId: String((info && info.messageId) || "")
  };
}

module.exports = {
  getSmtpConfig,
  isSmtpConfigured,
  sendMail
};
