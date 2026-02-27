const fs = require("fs");
const path = require("path");

function normalizeOrigin(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    return url.origin;
  } catch (err) {
    return "";
  }
}

const originArg = process.argv[2] || "";
const originEnv = process.env.SITE_ORIGIN || "";
const siteOrigin = normalizeOrigin(originArg) || normalizeOrigin(originEnv);

if (!siteOrigin) {
  console.error("Usage: node scripts/generate-seo-files.js https://your-domain.com");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: "/index.html", changefreq: "daily", priority: "1.0" },
  { loc: "/posts.html", changefreq: "daily", priority: "0.9" },
  { loc: "/projects/Aboutfull.html", changefreq: "monthly", priority: "0.6" },
  { loc: "/projects/NoteApp.html", changefreq: "monthly", priority: "0.5" }
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (item) => `  <url>
    <loc>${siteOrigin}${item.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

# Auth pages are not useful for search indexing.
Disallow: /login.html
Disallow: /signup.html
Disallow: /chat.html
Disallow: /follow-people.html
Disallow: /profile.html
Disallow: /user-profile.html
Disallow: /user-posts.html
Disallow: /upload.html
Disallow: /notifications.html
Disallow: /settings.html
Disallow: /insights.html
Disallow: /manage-posts.html
Disallow: /voice-call.html
Disallow: /video-call.html
Disallow: /admin-moderation.html
Disallow: /change-password.html
Disallow: /delete-account.html
Disallow: /media-viewer.html

Sitemap: ${siteOrigin}/sitemap.xml
`;

const frontendDir = path.join(process.cwd(), "frontend");
fs.writeFileSync(path.join(frontendDir, "sitemap.xml"), sitemap, "utf8");
fs.writeFileSync(path.join(frontendDir, "robots.txt"), robots, "utf8");

console.log(`SEO files generated for ${siteOrigin}`);
