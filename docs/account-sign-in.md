# Capycraft sign-in and Minecraft linking

Capycraft uses Discord and one-time email codes through Clerk. In the sign-in dialog, enter the code sent by Clerk when signing in with email. The account button shows the connected Discord profile image or the Clerk profile image in a square. It uses initials or an account icon if the image is unavailable. Open the account menu and choose **Minecraft accounts** to link Minecraft. The game code comes from Minecraft chat.

## Configure Clerk Development

1. In the Clerk Development instance, open **User & authentication → Email**. Enable sign-up and sign-in with email, require email verification at sign-up, and choose **Email verification code** for both sign-up verification and sign-in. Check **User & authentication → Password** if the sign-in dialog asks for a password. For a passwordless instance, disable password sign-in. If existing accounts still need password sign-in, set the instance's preferred sign-in strategy to `otp`. [Clerk authentication options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options) · [Instance settings API](https://clerk.com/docs/reference/backend/instance/update)
2. Under **SSO connections**, add **Discord** for all users and enable it for sign-up and sign-in. Clerk supplies shared Development OAuth credentials and a callback. [Clerk Discord setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/discord)
3. Use the matching Development keys from Clerk's **API keys** page. Set `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_AUTHORIZED_ORIGINS=http://127.0.0.1:5173` in the ignored `.env.local` file. For Vite preview, also allow `http://127.0.0.1:4173`. Separate exact origins with commas and omit trailing slashes. The browser receives only the publishable key. [Example configuration](../.env.example)
4. Use the [local development workflow](development.md#local-development) for the site and API. The browser build and Node service read their configuration at startup.

## Link Minecraft

1. Enable `listenerEnabled` and `accountLinksEnabled` on a dedicated WebCraft server that authenticates Minecraft UUIDs. Give it a dedicated `WEBCRAFT_ACCOUNT_LINK_TOKEN` with 43 to 128 URL-safe ASCII characters, then restart it.
2. In the private [instance configuration](webcraft-instances.md#instance-configuration), set `webcraftUrl` to the WebCraft loopback listener or the local end of a private tunnel, for example `http://127.0.0.1:8765`. Set `accountLinkTokenEnv` to a separate variable such as `WEBCRAFT_UNIVERSUM_ACCOUNT_LINK_TOKEN`. Give that variable the matching WebCraft pairing secret in the Capycraft API environment and restart the API. Use a different token for read feeds.
3. Sign in to Capycraft, choose **Minecraft accounts**, select the server, and run `/webcraft link` in Minecraft. Paste the private game code within five minutes. If a request is interrupted, try again using the same code. Obtain a fresh code if WebCraft no longer has the receipt.

Capycraft verifies the Clerk session before redeeming the code and sends the code and a reusable attempt ID to the WebCraft internal endpoint. Keep that endpoint off the public proxy and keep credentials and request bodies out of logs. Capycraft stores links in the private player SQLite database. Keep that database across releases. Each Capycraft account can link one Minecraft UUID per server alias, and each UUID can belong to one Capycraft account on that server.

To use both sign-in methods with the same account, verify the email address and connect Discord using **Manage account**. The Minecraft link persists across sessions for the same Clerk user. [Clerk OAuth account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)

## Deploy and verify

Configure the public HTTPS domain in Clerk Production and repeat the email configuration. Create a Discord OAuth application, add the exact callback URI from Clerk, and put the Discord client ID and secret into the Clerk Production connection. Set the Production publishable key for the browser build and for the Node service. Set its matching secret, the exact public HTTPS origin, and the pairing secret in the Node service. Route `/api/account` to Node through the [Caddy configuration](deployment.md#caddy-routes) and keep it out of shared caches. [Clerk production setup](https://clerk.com/docs/guides/development/deployment/production) · [Discord custom credentials](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/discord#configure-for-your-production-instance)

Check sign-in with both methods. Link a test Minecraft account, sign out, sign back in using the other method and confirm the link remains. Without a session, `GET /api/account` returns HTTP 401 when configured. Run `node --test tests/accounts.test.mts` for local verification using signed test sessions and a simulated WebCraft server.

## Planned player privacy controls

Before enabling player privacy controls, authorize each write against the verified Minecraft link. Enforce the preference on public feeds and cached data.
