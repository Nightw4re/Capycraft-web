# Historical Microsoft single sign-on setup

> Superseded by [Clerk sign-in and Minecraft linking](../account-sign-in.md). This page records setup for the previous MSAL integration. The callback and client ID setting were removed.

Microsoft sign-in is optional. Leave `VITE_MICROSOFT_CLIENT_ID` unset for regular site development and Storybook. When configured, Capycraft uses MSAL Browser to sign in with personal Microsoft accounts and show the account's display name in the header. Minecraft profile verification and player dashboard access are outside the current sign-in flow.

## Register the app in Microsoft Entra

Use separate registrations and client IDs for development and production. Both registrations can live in the same Entra tenant. Use the development registration for localhost and any shared preview. [Microsoft Entra test environments](https://learn.microsoft.com/en-us/entra/identity-platform/test-setup-environment)

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/) with access to create app registrations. Open **Entra ID → App registrations → New registration**. Name the development app `Capycraft Dev` and the production app `Capycraft`, and select **Personal accounts only** under **Supported account types**. [Microsoft app registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
2. In each registration, open **Authentication**, add a redirect URI under **Single-page application**, and save the URL for that environment from the table below. [Microsoft redirect URI setup](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri)
3. Copy the **Application (client) ID** from **Overview**. The browser app uses this public identifier and requests only the `openid` and `profile` scopes. It requires no client secret.

| Environment | Redirect URI |
| --- | --- |
| Local development | `http://localhost:5173/auth-redirect.html` |
| Shared development preview | The preview's HTTPS URL with `/auth-redirect.html` appended, for example `https://dev.example.com/auth-redirect.html` |
| Production | The live site's HTTPS URL with `/auth-redirect.html` appended, for example `https://capycraft.example.com/auth-redirect.html` |

Replace the example domains with the deployed domains. If the app is hosted under a subpath, include it in the registered URI, such as `https://example.com/capycraft/auth-redirect.html`. Capycraft resolves the callback relative to the page URL. Use `localhost` in the browser when using the localhost registration. The callback ends at `auth-redirect.html` and has no hash route. [Microsoft redirect URI requirements](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

## Enable sign-in locally

1. Copy `.env.example` to `.env.local` in the repository root.
2. Set `VITE_MICROSOFT_CLIENT_ID` in `.env.local` to the development application's **Application (client) ID**.
3. Start or restart `npm run dev` and open `http://localhost:5173/`. See [local development](../development.md#local-development) for Node.js and install instructions.

## Enable sign-in on a hosted site

1. Set `VITE_MICROSOFT_CLIENT_ID` in the build environment to the client ID for that deployment. Run `npm run build` and deploy the contents of `dist/`.
2. Serve `auth-redirect.html` as its own page at the registered URL. Make sure the host serves the callback without a `Cross-Origin-Opener-Policy` response header. [MSAL redirect bridge requirements](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge)

## Verify after configuration

Select **Sign in**, choose a personal Microsoft account, and check that the browser returns to Capycraft in the same tab and the header shows the account's display name. Reload the page in the same tab to check that the session persists. Then select **Sign out of Capycraft** and check that **Sign in** returns. This clears the Capycraft session in that tab and leaves the Microsoft session active.
