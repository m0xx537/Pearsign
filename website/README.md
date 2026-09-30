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

Before using UDID storage or automatic iPhone retrieval, run or rerun [`supabase/udid-storage.sql`](supabase/udid-storage.sql) in the Supabase Dashboard’s SQL Editor. It creates the account-owned UDID table and the short-lived enrollment request table. Row Level Security lets each signed-in user read, replace, or remove only their own UDID; automatic retrieval uses a callback token that expires after 15 minutes and binds to the first device submitted.

Existing installations that accepted only 40-character UDIDs must run [`supabase/udid-format-fix.sql`](supabase/udid-format-fix.sql). This transactional migration retains existing records and adds support for modern UDIDs in the `XXXXXXXX-XXXXXXXXXXXXXXXX` format in both the table constraint and the enrollment completion function. Keep the hyphen when storing these identifiers.

Then run [`supabase/udid-retry-fix.sql`](supabase/udid-retry-fix.sql) on existing installations. It retains completed requests until their original expiry so the same device can retry without a false 410, rejects a different device using the same token, and lets separate profile downloads coexist. New requests prune expired enrollment records; the account's saved device UDID is retained. Repeated successful callbacks acknowledge completion without changing a later saved UDID. Both updates are included in the full setup script.

The retrieval pattern follows [udid.tech](https://udid.tech/how-does-it-works) and [Apple's Profile Service documentation](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/iPhoneOTAConfiguration/profile-service/profile-service.html): an HTTPS `.mobileconfig` requests device attributes, iOS POSTs a signed plist, and a 301 redirect returns to the account page. The profile also includes Apple's `Challenge` field to carry its account request token. Pearsign asks for UDID only and stores it in the initiating account; no device data is sent to udid.tech. This checks identifier format and account association, not the cryptographic authenticity of Apple's signature.

For automatic iPhone retrieval, add `SUPABASE_SECRET_KEY` as a **server-only Production environment variable** in Vercel. Use the Supabase Secret API key (or the legacy service-role key as `SUPABASE_SERVICE_ROLE_KEY`). Never use either key in browser code or expose it publicly. `PEARSIGN_SITE_URL` is optional and defaults to `https://pear-sign.com`.

The signed-in user starts the request in Safari on the iPhone or iPad they are adding. The site creates an Apple Profile Service request asking for the UDID only; installing it sends the response to a Vercel function, which links it to the account that started the request. After saving, the callback redirects to the account page without including the UDID or enrollment token in the redirect URL. Device registration with Apple is a separate step and is not performed here.

UDIDs are device identifiers. Store them only for a clear purpose, and explain that purpose and retention to users. Certificate purchases, payment processing, Apple device registration, and certificate delivery are not connected.

## Regression checks

Run `node --test website/tests/udid-callback.test.cjs` for callback parsing, format validation, Challenge matching, and failure responses. For the full PostgreSQL lifecycle checks, install `@electric-sql/pglite` in a temporary tools folder and set `PEARSIGN_PGLITE_MODULE` to its absolute module path, then run `node --test website/tests/udid-callback.test.cjs website/tests/udid-enrollment.test.cjs`. The integration suite upgrades the former production schema in an isolated database and covers duplicate callbacks, overlapping downloads, expiration, preserving later account edits, and private RPC permissions. It skips explicitly when PGlite is unavailable. These checks use synthetic users and UDIDs and do not install a profile on an iPhone.
