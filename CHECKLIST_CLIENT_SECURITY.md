# ASCAPDX Full Improvement Checklist (Client + Security)

Use this as your master execution list.

## 1) Client Features (Product / UX)

- [ ] Add account recovery UX: email change flow with OTP confirmation.
- [ ] Add in-app onboarding tour for first login with "skip" + "restart tour" in settings.
- [ ] Add profile completion meter (avatar, bio, interests, links) to increase engagement.
- [ ] Add post drafts and auto-save for caption/media composer.
- [ ] Add post scheduling (datetime picker + timezone-aware publish).
- [ ] Add richer notifications preferences (mute likes/comments/follows separately).
- [ ] Add notification inbox filters (unread, mentions, follows, system).
- [ ] Add typing indicators and online indicators in chat thread list.
- [ ] Add pinned messages inside chat conversations.
- [ ] Add message search (keyword + date filter + sender filter).
- [ ] Add edit history viewer for edited messages/posts.
- [ ] Add "undo send" window for messages (5-10 seconds).
- [ ] Add story viewer analytics for creators (views, completion rate, replies).
- [ ] Add dark/light/system theme toggle with persisted preference.
- [ ] Add language/i18n support scaffold (starting with en + one additional language).
- [ ] Add keyboard shortcuts for power users (new post, search, open chat).
- [ ] Add skeleton loaders on feed/chat/profile for better perceived performance.
- [ ] Add empty-state UX with guided CTAs on new accounts.
- [ ] Add saved search and recent search history controls.
- [ ] Add optional "private mode" where online status is hidden.

## 2) Frontend Security Hardening

- [ ] Remove JWT token dependency from `localStorage`; rely on HttpOnly cookie only.
- [ ] Refactor frontend API calls to always use `APP_CONFIG.authFetch` for CSRF-safe writes.
- [ ] Remove ad-hoc `Authorization: Bearer` headers where cookie auth already works.
- [ ] Add strict output encoding everywhere user data is rendered as HTML.
- [ ] Introduce DOM sanitization library (e.g., DOMPurify) before any `innerHTML` with dynamic content.
- [ ] Replace high-risk `innerHTML` rendering paths with safe DOM node APIs where possible.
- [ ] Add Trusted Types policy (where browser support allows) to reduce DOM XSS risk.
- [ ] Add Subresource Integrity (SRI) for CDN scripts/styles where feasible.
- [ ] Self-host critical frontend libraries to reduce third-party script risk.
- [ ] Add stronger CSP policy for production pages and remove unnecessary `'unsafe-inline'`.
- [ ] Add `frame-ancestors 'none'`/tight value for pages that should not be embedded.
- [ ] Add secure handling for external links (`rel="noopener noreferrer"` consistently).
- [ ] Add client-side file validation before upload (size/type/signature pre-check).
- [ ] Add anti-clickjacking visual confirmation for sensitive actions (delete account, role changes).

## 3) Backend Security Hardening

- [ ] Add centralized request validation (Joi/Zod/express-validator) for every route body/query/params.
- [ ] Add password strength policy enforcement with clear error reasons.
- [ ] Add optional TOTP authenticator app 2FA (beyond email OTP).
- [ ] Add backup codes for 2FA recovery.
- [ ] Add device trust model ("remember this device" with risk checks).
- [ ] Add suspicious login detection (new IP/country/user-agent) + challenge step.
- [ ] Add geo-IP and impossible-travel detection events.
- [ ] Add step-up auth for sensitive actions (change email/password, delete account, role changes).
- [ ] Add webhook/email alerts for critical security events (admin role change, lock spikes).
- [ ] Add API idempotency keys for sensitive POST operations.
- [ ] Add replay protection window for critical tokenized actions.
- [ ] Add stricter upload security: malware scanning queue and quarantine before publish.
- [ ] Add media EXIF metadata stripping on uploaded images.
- [ ] Add denylist/allowlist controls for risky URLs in user content.
- [ ] Add account deletion grace period with reversible restore window.
- [ ] Add immutable security audit log stream (separate retention policy).

## 4) Platform Reliability / Observability

- [ ] Add structured log sink integration (Datadog/ELK/Loki/etc).
- [ ] Add request/trace correlation across HTTP + Socket.IO events.
- [ ] Add dashboards: API latency p95/p99, error rate, auth failures, OTP send success, Redis health.
- [ ] Add uptime probes for frontend and backend from external region monitors.
- [ ] Add SLO targets (availability + latency) and alert policies.
- [ ] Add dead-letter handling/retry strategy for email delivery failures.
- [ ] Add queue system for async tasks (emails, notifications, moderation jobs).
- [ ] Add graceful shutdown hooks for HTTP, sockets, and background tasks.
- [ ] Add DB index review and slow-query monitoring.
- [ ] Add disaster recovery runbook and RTO/RPO targets.

## 5) Data Protection / Compliance

- [ ] Add privacy settings for profile discoverability and data sharing.
- [ ] Add data export endpoint (user can download account data).
- [ ] Add explicit consent logs for policy/terms acceptance versions.
- [ ] Add configurable retention + deletion policy per data type.
- [ ] Add legal hold mechanism for abuse/security investigations.
- [ ] Add regional data handling notes in docs (if serving multiple jurisdictions).

## 6) Testing and Release Gates

- [ ] Add E2E browser tests for signup/login/chat/post flows (Playwright/Cypress).
- [ ] Add security tests for CSRF, auth bypass, privilege escalation, and rate-limit bypass.
- [ ] Add load tests for auth endpoints and chat message burst handling.
- [ ] Add fuzz tests for parser/input-heavy endpoints.
- [ ] Add snapshot tests for critical API contracts.
- [ ] Add CI gates: lint, tests, coverage threshold, dependency audit.
- [ ] Add pre-release checklist requiring health endpoint, alerts, and backups validated.
- [ ] Add canary deployment and rollback checklist.

## 7) Current-Code Priority Fixes (do these first)

- [ ] Frontend auth cleanup:
  - remove localStorage JWT usage and standardize on cookie + CSRF.
- [ ] XSS hardening:
  - audit all dynamic `innerHTML` paths and sanitize/replace unsafe rendering.
- [ ] Input validation baseline:
  - enforce schema validation in all backend route handlers.
- [ ] Security eventing:
  - ensure every auth failure/lock/role change emits standardized event records.
- [ ] Monitoring baseline:
  - connect logs + health alerts to real alert channels.
- [ ] Backup validation baseline:
  - install MongoDB tools in production runners and verify scheduled restore checks pass.

## 8) Go-Live Security Checklist

- [ ] `NODE_ENV=production` confirmed.
- [ ] Strong `JWT_SECRET` (32+ chars), rotated and stored in secret manager.
- [ ] `CLIENT_ORIGIN` locked to production domains only.
- [ ] HTTPS enforced at edge/proxy and HSTS active.
- [ ] SMTP creds stored in secrets manager, not in repo.
- [ ] Redis enabled for distributed rate limiting in multi-instance deployments.
- [ ] Health alerts configured (`HEALTH_ALERT_EMAIL_TO` or alert webhook path).
- [ ] Backup validation job enabled and tested.
- [ ] Admin account inventory reviewed; least privilege applied.
- [ ] Dependency vulnerability scan reviewed and patched.
- [ ] Upload/storage access controls validated.
- [ ] Incident response contacts and runbook documented.
