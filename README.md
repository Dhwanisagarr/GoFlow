# GoFlow

A gentle daily planning app: capture everything on your mind, turn it into small steps, and focus on one card at a time. Tasks, completion status, and timer records are stored locally in your browser.

## Run locally

1. Install Node.js 20.19 or newer.
2. Run `npm install`.
3. Run `npm run dev` and open http://localhost:3000.

The app works as a demo without credentials. For AI-generated planning, copy `.env.example` to `.env.local`, add `OPENAI_API_KEY`, and optionally set `OPENAI_MODEL`. The key is used only by the server route and never sent to the browser. Keep the key private; set it as a server-side environment variable when deploying to Vercel.

## Deploy to Vercel

1. Import `Dhwanisagarr/onething` from GitHub in Vercel and deploy the `master` branch. Vercel detects Next.js automatically; use the repository root and the default install/build/output settings (`npm install`, `npm run build`, and `.next`). No custom `vercel.json` is needed.
2. Use Node.js 22.x in the Vercel project settings. The project requires Node.js 20.19 or newer.
3. To enable AI planning, add `OPENAI_API_KEY` under **Project Settings → Environment Variables** for Production (and Preview if desired). Optionally add `OPENAI_MODEL`; if omitted, the app uses its configured default. Do not prefix the key with `NEXT_PUBLIC_`. Without the key, the app still deploys and uses its local demo planner.
4. Redeploy after changing environment variables. Configure Vercel Firewall rate limiting for `POST /api/plan` before sharing a public URL; the app's in-process rate limit is not shared across serverless instances.

## Vercel Web Analytics

The root layout includes `@vercel/analytics/next`. Enable **Web Analytics** in the GoFlow project's Vercel dashboard under **Analytics**; Vercel starts collecting page views after the next deployment. GoFlow does not send task titles, dictated text, or custom task events to Analytics.

Task cards and history stay in each visitor's browser storage. This deployment does not provide accounts, cross-device sync, server backups, or per-user data separation.

## MVP notes

- Browser local storage keeps daily plans and timer totals on this device.
- The AI prompt preserves stated fixed times, avoids fabricating schedules, and breaks larger work into manageable steps.
- Browser speech recognition is optional; text entry is always available.
- This is a demonstration product. It has no account sync or cross-device backup yet.


## Security and public deployment

Read [SECURITY.md](SECURITY.md) before making the app public. It documents the browser-only data model, server-side AI key handling, and the Vercel Firewall step needed for durable public rate limiting.
