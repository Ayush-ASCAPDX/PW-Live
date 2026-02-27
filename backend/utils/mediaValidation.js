const fs = require("fs/promises");

function startsWithBytes(buffer, bytes) {
  if (!buffer || !bytes || buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

function detectMediaKindFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // PNG
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  // JPEG
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return "image";
  // GIF87a / GIF89a
  if (startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38])) return "image";
  // WEBP: RIFF....WEBP
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image";

  // MP4/MOV family: ....ftyp
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") return "video";
  // WebM / MKV (EBML)
  if (startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return "video";
  // OGG
  if (startsWithBytes(buffer, [0x4f, 0x67, 0x67, 0x53])) return "video";

  return null;
}

async function validateStoredMediaFile(filePath, mimeType = "") {
  const file = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const sample = header.subarray(0, bytesRead);
    const kind = detectMediaKindFromBuffer(sample);
    if (!kind) return { ok: false, kind: null };

    const normalizedMime = String(mimeType || "").trim().toLowerCase();
    if (normalizedMime.startsWith("image/") && kind !== "image") return { ok: false, kind };
    if (normalizedMime.startsWith("video/") && kind !== "video") return { ok: false, kind };
    return { ok: true, kind };
  } finally {
    await file.close();
  }
}

module.exports = {
  validateStoredMediaFile
};
