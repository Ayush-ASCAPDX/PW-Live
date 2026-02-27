const Notification = require("../models/Notification");
const User = require("../models/User");

function isNotificationAllowed(userDoc, type) {
  if (!userDoc) return true;
  const prefs = userDoc.notificationPrefs || {};
  if (Object.prototype.hasOwnProperty.call(prefs, type)) {
    if (prefs[type] === false) return false;
  }
  const quiet = userDoc.notificationQuietHours || {};
  const enabled = !!quiet.enabled;
  if (enabled) {
    const startHour = Number(quiet.startHour);
    const endHour = Number(quiet.endHour);
    const timezone = String(quiet.timezone || "UTC");
    if (Number.isFinite(startHour) && Number.isFinite(endHour)) {
      let hour = new Date().getUTCHours();
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          hour12: false,
          timeZone: timezone
        }).formatToParts(new Date());
        const hourPart = parts.find((p) => p.type === "hour");
        if (hourPart) hour = Number(hourPart.value);
      } catch (err) {
        hour = new Date().getUTCHours();
      }
      if (startHour === endHour) return true;
      if (startHour < endHour && hour >= startHour && hour < endHour) return false;
      if (startHour > endHour && (hour >= startHour || hour < endHour)) return false;
    }
  }
  return true;
}

async function createNotification(payload = {}) {
  try {
    const recipientUsername = String(payload.recipientUsername || "").trim();
    const actorUsername = String(payload.actorUsername || "").trim();
    const type = String(payload.type || "").trim();
    const text = String(payload.text || "").trim();
    const entityType = String(payload.entityType || "").trim();
    const entityId = payload.entityId ? String(payload.entityId).trim() : "";
    const link = payload.link ? String(payload.link).trim() : "";

    if (!recipientUsername || !type || !text) return null;
    if (actorUsername && actorUsername === recipientUsername) return null;
    const recipient = await User.findOne({ username: recipientUsername }).select("notificationPrefs");
    if (!isNotificationAllowed(recipient, type)) return null;

    const doc = await Notification.create({
      recipientUsername,
      actorUsername,
      type,
      text,
      entityType,
      entityId,
      link
    });
    return doc;
  } catch (err) {
    return null;
  }
}

module.exports = {
  createNotification
};
