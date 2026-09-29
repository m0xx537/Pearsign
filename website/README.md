# Pearsign website

This folder contains the Pearsign website and its account sign-in page. In Vercel, set the project **Root Directory** to `website`. The site is served as static pages, with one small Vercel function at `/api/config` that provides the public Supabase connection settings to the browser.

## Enable sign-in on Vercel

Add these Production environment variables to the Vercel project, then redeploy:

- `SUPABASE_URL` — the Project URL from the Supabase Connect dialog.
- `SUPABASE_PUBLISHABLE_KEY` — the publishable key from the same dialog.

The publishable key is intended for browser and mobile clients. Never add a Supabase secret key, service-role key, or database password here or to the browser app.

In Supabase **Authentication → URL Configuration**, set the Site URL to `https://pear-sign.com` and add `https://pear-sign.com/account/` as a redirect URL. Keep email confirmation enabled.

The account page supports email sign-up, sign-in, email verification, password reset, and sign-out. Certificate purchases, payment processing, and certificate delivery are not connected yet.
