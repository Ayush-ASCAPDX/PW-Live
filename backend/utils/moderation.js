function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCKED_WORD_PATTERNS = [
  /\bfuck(?:er|ing|ed|s)?\b/i,
  /\bshit(?:ty|s)?\b/i,
  /\basshole\b/i,
  /\bbitch(?:es)?\b/i,
  /\bbastard(?:s)?\b/i,
  /\bmotherfucker(?:s)?\b/i
];

const LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;
const HIGH_RISK_LINK_PATTERN = /(bit\.ly|tinyurl\.com|t\.me|discord\.gg|grabify|iplogger)/i;
const SPAM_PHRASE_PATTERN = /(earn money fast|free money|guaranteed profit|crypto signal|dm for offer)/i;

function findModerationIssue(text = "") {
  const raw = String(text || "");
  const normalized = normalizeText(raw);
  if (!normalized) return null;

  const badWord = BLOCKED_WORD_PATTERNS.find((rx) => rx.test(normalized));
  if (badWord) {
    return { code: "abusive_language", message: "Message blocked: abusive language is not allowed." };
  }

  const links = normalized.match(LINK_PATTERN) || [];
  if (links.length >= 3) {
    return { code: "spam_links", message: "Message blocked: too many links detected." };
  }
  if (links.length >= 1 && HIGH_RISK_LINK_PATTERN.test(normalized)) {
    return { code: "spam_links", message: "Message blocked: suspicious links are not allowed." };
  }
  if (SPAM_PHRASE_PATTERN.test(normalized)) {
    return { code: "spam_text", message: "Message blocked: spam content detected." };
  }

  return null;
}

module.exports = {
  findModerationIssue
};
