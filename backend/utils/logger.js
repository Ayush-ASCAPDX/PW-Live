function formatMeta(meta) {
  if (meta === undefined) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (err) {
    return " [unserializable-meta]";
  }
}

function shouldLogToConsole() {
  const raw = String(process.env.LOG_TO_CONSOLE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function info(message, meta) {
  if (!shouldLogToConsole()) return;
  console.log(`[INFO] ${String(message || "")}${formatMeta(meta)}`);
}

function warn(message, meta) {
  if (!shouldLogToConsole()) return;
  console.warn(`[WARN] ${String(message || "")}${formatMeta(meta)}`);
}

function error(message, meta) {
  if (!shouldLogToConsole()) return;
  console.error(`[ERROR] ${String(message || "")}${formatMeta(meta)}`);
}

module.exports = {
  info,
  warn,
  error
};
