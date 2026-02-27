const mongoose = require("mongoose");

const storySchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  authorUsername: {
    type: String,
    required: true
  },
  authorDisplayName: {
    type: String,
    default: ""
  },
  authorAvatarUrl: {
    type: String,
    default: ""
  },
  mediaUrl: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    enum: ["image", "video"],
    required: true
  },
  views: [{
    username: {
      type: String,
      required: true
    },
    viewedAt: {
      type: Date,
      default: Date.now
    }
  }],
  reactions: [{
    username: {
      type: String,
      required: true
    },
    emoji: {
      type: String,
      required: true,
      maxlength: 8
    },
    reactedAt: {
      type: Date,
      default: Date.now
    }
  }],
  replies: [{
    fromUsername: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

// Keep stories temporary like Instagram/Facebook (24 hours).
storySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model("Story", storySchema);
