# ASCAPDX Digital

Full-stack community app with:
- Static frontend pages (`frontend/`)
- Node.js + Express + MongoDB backend (`backend/`)
- Realtime chat/call signaling with Socket.IO

## Requirements

- Node.js 18+
- MongoDB running locally or remotely

## Backend Setup

1. Open a terminal in `backend/`
2. Install dependencies:

```bash
npm install
```

3. Create `backend/.env`:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/ASCAPDX-COMMUNITY
JWT_SECRET=replace-with-a-strong-secret
CLIENT_ORIGIN=http://localhost:5500
UPLOAD_MAX_MB=100
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-password-or-app-password
FROM_EMAIL=your-email@example.com
REDIS_URL=redis://127.0.0.1:6379
```

4. Run backend:

```bash
npm run dev
```

5. Run backend tests:

```bash
npm test
```

Integration tests use an in-memory MongoDB instance (`mongodb-memory-server`), so no local MongoDB is required for tests.

## Frontend Setup

Serve `frontend/` with any static server.  
Frontend uses:
- `localStorage.backendOrigin` if set
- otherwise falls back to `http://localhost:5000`
- `robots.txt` and `sitemap.xml` are available in `frontend/`
- Generate production SEO files with your real domain:

```bash
node scripts/generate-seo-files.js https://your-domain.com
```

- Canonical/OG/Twitter URLs are resolved at runtime by `frontend/js/seo-meta.js` using:
  - `window.SITE_ORIGIN` (if provided), else
  - `localStorage.siteOrigin` (if set), else
  - current `window.location.origin`

Optional (in browser console):

```js
localStorage.setItem("backendOrigin", "http://localhost:5000");
```

## Auth Notes

- Login now issues JWT in an `HttpOnly` cookie (`auth_token`)
- Frontend stores only profile/session metadata in `localStorage` (no JWT)
- API write actions and Socket.IO use cookie-based auth (`credentials: include`)
- Every account has a `role` field. Default role is `user`.
- Login is protected against brute-force attempts:
  - 5 failed attempts lock login for 15 minutes
- OTP verification is protected against brute-force attempts:
  - 5 invalid OTP attempts invalidate the OTP and require requesting a new one
- API request rate limits are applied to:
  - `/api/auth/*`
  - `/api/contact`
  - `/api/reports`
  - Use `REDIS_URL` to enable distributed/shared rate-limits across instances
- Signup now requires email OTP verification:
  - `POST /api/auth/request-otp`
  - `POST /api/auth/verify-otp`
  - `POST /api/auth/register` (server-enforced: allowed only after OTP verification)
- Login now uses email OTP (2FA):
  - `POST /api/auth/login/request-otp` (validate password, send OTP)
  - `POST /api/auth/login/verify-otp` (verify OTP, issue JWT)
- Session management endpoints:
  - `POST /api/auth/logout` (revoke current session)
  - `GET /api/users/sessions` (list active sessions)
  - `DELETE /api/users/sessions/:sessionId` (revoke one session)
  - `DELETE /api/users/sessions` (revoke all other sessions)
  - `PATCH /api/users/sessions/:sessionId/label` (name a device/session)
- Admin role management endpoint:
  - `PATCH /api/admin/users/:username/role` with body `{ "role": "user" | "admin" }`
- Admin security monitoring endpoints:
  - `GET /api/admin/security-events`
  - `GET /api/admin/lockouts`
  - `GET /api/admin/otp-telemetry`
- Content moderation filters are enabled for:
  - post captions (create/edit)
  - post comments and replies
  - story replies
  - chat messages (REST and Socket.IO)

## Important

- `backend/node_modules` and upload folders should not be committed
- Use `.gitignore` in this repo root
