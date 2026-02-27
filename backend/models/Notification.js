const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipientUsername: {
    type: String,
    required: true,
    index: true
  },
  actorUsername: {
    type: String,
    default: ""
  },
  type: {
    type: String,
    required: true,
    enum: ["like", "comment", "reply", "mention", "follow", "follow_request", "message", "call_missed", "collection_save"]
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  entityType: {
    type: String,
    default: "",
    maxlength: 40
  },
  entityId: {
    type: String,
    default: "",
    maxlength: 120
  },
  link: {
    type: String,
    default: "",
    maxlength: 240
  },
  readAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);
