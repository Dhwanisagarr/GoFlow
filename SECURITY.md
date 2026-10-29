# Security and deployment notes

## What this MVP protects

- `OPENAI_API_KEY` is read only by the server route. Never name it `NEXT_PUBLIC_OPENAI_API_KEY` or put it in client code. `.env*` files are ignored by Git except the empty `.env.example` template.
- The planner route accepts same-origin JSON only, bounds request sizes and task fields, rate-limits requests by client IP within a running server instance, validates AI output before applying it, and returns non-cacheable responses with generic errors.
- Security headers include a Content Security Policy, frame blocking, MIME sniffing protection, a strict referrer policy, and production HSTS.
- This repository has no admin page, password, user account system, database, or server-side data logs.

## Data and account limits

Task history is kept in browser local storage. Different browser profiles/devices have separate data; anyone using the same browser profile can see that profile's tasks. There is no account login, cross-device isolation, database backup, or automatic daily backup in this MVP. A database-backed multi-user release needs an authentication provider and per-user authorization rules before it should store users' plans on a server.

When `OPENAI_API_KEY` is configured, brain dumps and task context are sent from the server to OpenAI to generate or update plans. Without the key, the app uses the local demo planner. Do not enter credentials or other secrets into brain dumps.

## Before a public Vercel deployment

1. Add `OPENAI_API_KEY` as a Vercel **server-side** environment variable for Production. Do not expose it with a `NEXT_PUBLIC_` prefix. Rotate the key immediately if it was ever committed or shared.
2. Add a Vercel Firewall rule for `POST /api/plan` to challenge or rate-limit abusive traffic. The in-process limiter is a best-effort safeguard and is not a durable, cross-instance quota on serverless deployments.
3. Protect Preview deployments in Vercel so unfinished previews are not public. Keep Production public only if that is the intended audience.
4. Run `npm audit` after dependency changes and deploy only after `npm run build` and `npm test` pass.
5. If you add a database or accounts, configure database-level per-user access rules and backups before storing personal plans there.
