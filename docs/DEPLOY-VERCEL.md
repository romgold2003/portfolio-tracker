# Putting it on Vercel

Everything in the repo is already configured. These are the steps only you can
do, because they happen inside your Vercel account.

## 1. Import the repo

Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import
`romgold2003/portfolio-tracker`.

Change nothing on the settings screen. `vercel.json` already tells Vercel to run
`npm run build:site`, publish `_site`, and serve `api/` as functions. Press
**Deploy**.

You now have a working app on a `*.vercel.app` URL — but still in **local mode**,
because there is no database yet. Everyone who visits gets their own journal in
their own browser. That is expected at this point.

## 2. Add the database

In the project, open **Storage → Create Database → Neon (Postgres)**. Take the
free plan and connect it to this project.

Vercel sets the connection string as an environment variable. The app accepts
whichever name Vercel uses (`DATABASE_URL`, `POSTGRES_URL`, and two older ones),
so nothing needs configuring.

The tables create themselves on the first request. There is no migration to run.

## 3. Redeploy

**Deployments → ⋯ on the newest one → Redeploy.**

This is the step that is easy to miss: functions only pick up an environment
variable on a deployment made after it existed. Until you redeploy, the app will
still say it has no cloud.

Check it worked by opening `https://<your-app>.vercel.app/api/config`. It should
say:

```json
{"cloud":true,"emailReset":false}
```

If `cloud` says `false`, the redeploy did not happen or the database is not
connected to this project. `emailReset` is covered below.

## 4. Name it

**Settings → Domains** for a custom domain, or rename the project under
**Settings → General** to change the `*.vercel.app` subdomain.

`riskbook.vercel.app` was free when this was written, along with
`carrybook`, `highwatermark` and `netliq-app`. `netliq` was taken.

## Optional: reset a forgotten password by email

Off by default. Turning it on changes what this deployment can do and what it
can see, so read the trade-off before you do it.

**What you get.** "Forgot password" sends a link. The person clicks it, chooses
a new password, and their journal is still there. New accounts stop being shown
a recovery key at sign-up, because they no longer need one.

**What it costs.** For a link to restore access to encrypted data, something
reachable from that link has to be able to produce the key — so the server keeps
a copy of every user's data key, and can therefore decrypt their journal. There
is no arrangement where an email link works and this is not true. Without it,
the server holds only ciphertext and a lost password means a lost journal unless
the recovery key was kept.

The copy is encrypted under `ESCROW_SECRET`, which lives in Vercel's
environment and never in the database, so a leaked database on its own is still
useless. Someone with both can read everything.

### 1. A mail provider

Brevo's free tier sends 300 messages a day and will send from a single verified
address, which matters: most providers require a domain you control, and
`*.vercel.app` is not one.

1. Sign up at [brevo.com](https://www.brevo.com).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender.** Use an address
   you can receive mail at. Click the link they send you.
3. **SMTP & API → API Keys → Generate a new API key.** Copy it.

### 2. Two environment variables

**Settings → Environment Variables**, then redeploy:

| Name | Value |
|---|---|
| `MAIL_API_KEY` | the Brevo API key |
| `MAIL_FROM` | the sender address you verified |
| `MAIL_FROM_NAME` | optional, defaults to `Riskbook` |
| `ESCROW_SECRET` | a long random string — see below |

Generate the escrow secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Keep it.** Change it and every account created before the change can no longer
be reset by email — the stored keys will not open. Those users fall back to
their recovery key, and anyone who signed up after reset links were enabled does
not have one.

`/api/config` should then say `"emailReset":true`.

### What happens to accounts that already exist

Nothing, until they sign up again. Reset links only work for accounts created
*after* you turned this on, because only those handed over a copy of their key.
Everyone older keeps their recovery key, and "Forgot password" still offers
"Use a recovery key instead" for them.

## Optional: pin the decoy secret

Add an environment variable `DECOY_SECRET` set to any long random string.

Without it the app generates one and stores it in the database, which is fine.
Setting it explicitly means the value survives you ever dropping and recreating
the database. It is what makes "no account for that email" indistinguishable
from a real one, so if you set it, do not change it later.

## What you are signing up for

- **Vercel's Hobby plan forbids commercial use.** Free for friends is fine;
  charging for it is not, and you would need a paid plan.
- **You are now holding other people's financial records.** If someone asks you
  to delete their account, you should be able to.
- **How readable those records are is your choice**, and it is the one above.
  Without email reset, they are ciphertext you cannot open, and nobody can
  rescue a forgotten password — including you. With it, you hold the keys, and
  anyone who obtains both your database and your `ESCROW_SECRET` holds them too.
  Neither answer is wrong; only one of them lets people back in when they forget.

## Keeping GitHub Pages

The Pages deploy still runs on every push and still works — it has no `api/`
directory, so it stays in local mode, which is right for a link you hand to
someone who just wants to try it. Both hosts build from the same command, so
they cannot drift.
