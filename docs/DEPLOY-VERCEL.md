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
{"cloud":true}
```

If it says `false`, the redeploy did not happen or the database is not connected
to this project.

## 4. Name it

**Settings → Domains** for a custom domain, or rename the project under
**Settings → General** to change the `*.vercel.app` subdomain.

`riskbook.vercel.app` was free when this was written, along with
`carrybook`, `highwatermark` and `netliq-app`. `netliq` was taken.

## Optional: pin the decoy secret

Add an environment variable `DECOY_SECRET` set to any long random string.

Without it the app generates one and stores it in the database, which is fine.
Setting it explicitly means the value survives you ever dropping and recreating
the database. It is what makes "no account for that email" indistinguishable
from a real one, so if you set it, do not change it later.

## What you are signing up for

- **Vercel's Hobby plan forbids commercial use.** Free for friends is fine;
  charging for it is not, and you would need a paid plan.
- **You are now holding other people's financial records.** Encrypted ones you
  cannot read, which is the whole point of the design — but if someone asks you
  to delete their account, you should be able to.
- **Nobody can rescue a forgotten password**, including you. That is stated
  plainly on the sign-up screen, and it is why the recovery key screen will not
  let anyone past without ticking the box.

## Keeping GitHub Pages

The Pages deploy still runs on every push and still works — it has no `api/`
directory, so it stays in local mode, which is right for a link you hand to
someone who just wants to try it. Both hosts build from the same command, so
they cannot drift.
