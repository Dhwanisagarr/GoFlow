# One Thing

A gentle daily planning app: capture everything on your mind, turn it into small steps, and focus on one card at a time. Tasks, completion status, and timer records are stored locally in your browser.

## Run locally

1. Install Node.js 20.19 or newer.
2. Run `npm install`.
3. Run `npm run dev` and open http://localhost:3000.

The app works as a demo without credentials. For AI-generated planning, copy `.env.example` to `.env.local`, add `OPENAI_API_KEY`, and optionally set `OPENAI_MODEL`. The key is used only by the server route and never sent to the browser. Keep the key private; set it as a server-side environment variable when deploying to Vercel.

## MVP notes

- Browser local storage keeps daily plans and timer totals on this device.
- The AI prompt preserves stated fixed times, avoids fabricating schedules, and breaks larger work into manageable steps.
- Browser speech recognition is optional; text entry is always available.
- This is a demonstration product. It has no account sync or cross-device backup yet.


## Security and public deployment

Read [SECURITY.md](SECURITY.md) before making the app public. It documents the browser-only data model, server-side AI key handling, and the Vercel Firewall step needed for durable public rate limiting.
