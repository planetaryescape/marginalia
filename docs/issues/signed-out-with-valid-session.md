# Reader showed the sign-in screen with a valid session until the browser restarted

Seen 2026-10-16 in an automated Chrome session (agent-browser, long-lived profile) right after the frontend deploy of `8741fbd`, and once earlier the same day during a spike.

What was observed, in that browser:

- The app rendered "Your reading desk · Sign in to return to your articles and notes", which `auth-gate.tsx` shows when `useConvexAuth().isAuthenticated` is false.
- A page reload did not fix it.
- At the same time, `GET /api/auth/get-session` returned 200 with a session, `GET /api/auth/convex/token` returned 200 with a JWT (issuer `https://stoic-hare-718.eu-west-1.convex.site`, audience `convex`, not expired), and a direct `POST /api/query` for `auth:currentReader` with that JWT returned the owner. So the session, the token and the backend's auth were all fine.
- Closing and reopening the browser fixed it immediately.

Not yet known: whether the PWA service worker served a stale bundle across the reload (the first suspect, because only a browser restart cleared it), or the Convex client kept a failed auth state. Not yet seen in a normal browser or on the phone.

Next step: when it recurs, capture `navigator.serviceWorker.controller?.scriptURL`, the loaded `_next/static` chunk hashes against the deployed build, and the Convex client's auth state (`convex.connectionState()`), before restarting anything.
