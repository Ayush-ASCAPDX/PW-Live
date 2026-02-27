const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

function looksLikeBcryptHash(value = "") {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value));
}

async function hashIfNeeded(value) {
  const raw = String(value || "");
  if (!raw) return raw;
  if (looksLikeBcryptHash(raw)) return raw;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(raw, salt);
}

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  password: {
    type: String,
    required: true
  },

  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user"
  },

  displayName: {
    type: String,
    default: ""
  },

  bio: {
    type: String,
    default: ""
  },

  profilePic: {
    type: String,
    default: ""
  },

  isVerified: {
    type: Boolean,
    default: false
  },

  coverImageUrl: {
    type: String,
    default: ""
  },

  websiteUrl: {
    type: String,
    default: ""
  },

  socialLinks: {
    instagram: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    github: { type: String, default: "" },
    x: { type: String, default: "" }
  },

  themeColor: {
    type: String,
    default: "#31c0ff"
  },

  pinnedPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    default: null
  },

  isOnline: {
    type: Boolean,
    default: false
  },

  showOnlineStatus: {
    type: Boolean,
    default: true
  },

  notificationPrefs: {
    like: { type: Boolean, default: true },
    comment: { type: Boolean, default: true },
    reply: { type: Boolean, default: true },
    mention: { type: Boolean, default: true },
    follow: { type: Boolean, default: true },
    message: { type: Boolean, default: true },
    call_missed: { type: Boolean, default: true },
    collection_save: { type: Boolean, default: true },
    follow_request: { type: Boolean, default: true }
  },

  notificationQuietHours: {
    enabled: { type: Boolean, default: false },
    startHour: { type: Number, default: 22 },
    endHour: { type: Number, default: 7 },
    timezone: { type: String, default: "UTC" }
  },

  privacySettings: {
    accountVisibility: {
      type: String,
      enum: ["public", "private"],
      default: "public"
    },
    allowMessagesFrom: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone"
    },
    allowCallsFrom: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone"
    },
    allowCommentsFrom: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone"
    }
  },

  mutedUsers: [{
    type: String
  }],

  bookmarkCollections: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 48
    },
    postIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post"
    }]
  }],

  onboardingState: {
    completed: { type: Boolean, default: false },
    dismissedAt: { type: Date, default: null }
  },

  pinnedChats: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  lastSeen: {
    type: Date,
    default: Date.now
  },

  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  followRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  savedPosts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post"
  }],

  sessions: [{
    sid: {
      type: String,
      required: true
    },
    label: {
      type: String,
      default: ""
    },
    userAgent: {
      type: String,
      default: ""
    },
    ip: {
      type: String,
      default: ""
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    lastSeenAt: {
      type: Date,
      default: Date.now
    }
  }],

  failedLoginCount: {
    type: Number,
    default: 0
  },

  loginLockedUntil: {
    type: Date,
    default: null
  }

}, { timestamps: true });

userSchema.pre("save", async function preSave() {
  if (!this.isModified("password")) return;
  this.password = await hashIfNeeded(this.password);
});

async function preUpdatePassword() {
  const update = this.getUpdate() || {};
  if (Object.prototype.hasOwnProperty.call(update, "password")) {
    update.password = await hashIfNeeded(update.password);
  }
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, "password")) {
    update.$set.password = await hashIfNeeded(update.$set.password);
  }
  this.setUpdate(update);
}

userSchema.pre("findOneAndUpdate", preUpdatePassword);
userSchema.pre("updateOne", preUpdatePassword);

module.exports = mongoose.model("User", userSchema);
