# Pearsign website

This folder contains the Pearsign website and its account sign-in page. In Vercel, set the project **Root Directory** to `website`. The site is mostly static pages, with Vercel functions for public Supabase configuration and the private UDID enrollment callback flow.

## Enable sign-in on Vercel

Add these Production environment variables to the Vercel project, then redeploy:

- `SUPABASE_URL` — the Project URL from the Supabase Connect dialog.
- `SUPABASE_PUBLISHABLE_KEY` — the publishable key from the same dialog.

The publishable key is intended for browser and mobile clients. Never put a Supabase secret key, service-role key, or database password in browser code.

In Supabase **Authentication → URL Configuration**, set the Site URL to `https://pear-sign.com` and add `https://pear-sign.com/account/` as a redirect URL. Keep email confirmation enabled.

The account page supports email sign-up, sign-in, email verification, password reset, and sign-out. It can also request a device UDID from Safari on an iPhone or iPad, or check and save a manually entered UDID. This does not register a device with Apple.

## Enable account-linked UDID storage

Before using UDID storage or automatic iPhone retrieval, run or rerun [`supabase/udid-storage.sql`](supabase/udid-storage.sql) in the Supabase Dashboard’s SQL Editor. It creates the account-owned UDID table and the short-lived enrollment request table. Row Level Security lets each signed-in user read, replace, or remove only their own UDID; automatic retrieval uses a one-time callback token that expires after 15 minutes.

For automatic iPhone retrieval, add `SUPABASE_SECRET_KEY` as a **server-only Production environment variable** in Vercel. Use the Supabase Secret API key (or the legacy service-role key as `SUPABASE_SERVICE_ROLE_KEY`). Never use either key in browser code or expose it publicly. `PEARSIGN_SITE_URL` is optional and defaults to `https://pear-sign.com`.

The signed-in user starts the request in Safari on the iPhone or iPad they are adding. The site creates an Apple Profile Service request asking for the UDID only; installing it sends the response to a Vercel function, which links it to the account that started the request. The browser then offers a link back to that account. Device registration with Apple is a separate step and is not performed here.

UDIDs are device identifiers. Store them only for a clear purpose, and explain that purpose and retention to users. Certificate purchases, payment processing, Apple device registration, and certificate delivery are not connected.
