const http = require("http");
const fs = require("fs");
const path = require("path");

const FRONTEND_DIR = path.join(__dirname, "..", "..", "frontend");
const PORT = 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function safePath(urlPath) {
  const raw = String(urlPath || "/").split("?")[0].split("#")[0];
  const normalized = decodeURIComponent(raw === "/" ? "/index.html" : raw);
  const full = path.normalize(path.join(FRONTEND_DIR, normalized));
  if (!full.startsWith(FRONTEND_DIR)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const file = safePath(req.url);
  if (!file) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1");
