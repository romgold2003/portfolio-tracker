# Cloud accounts

The app runs in one of two modes, decided by the deployment rather than by a
setting. At boot it asks `/api/config` whether there is a database behind it.

| | Local mode | Cloud mode |
| --- | --- | --- |
| Where the journal lives | this browser's `localStorage` | a Postgres row |
| Same account on another device | no | yes |
| What the server can read | there is no server | nothing |
| Where it runs | `file://`, GitHub Pages, `npm start` | Vercel with a database |

Local mode is not a downgrade — it is the right answer for the single-file build
that gets emailed to a friend. Nothing about cloud mode is bolted onto it; the
same encryption runs in both, and the server is only ever storing the output.

## What the server holds

Everything below is inert on its own.

| Column | What it is |
| --- | --- |
| `email` | an identifier |
| `auth_salt` | random, public by necessity — the client needs it before it can prove anything |
| `auth_hash` | scrypt of a value derived from the password, not of the password |
| `pw_wrapper` | the data key, encrypted under the password |
| `rec_wrapper` | the same data key, encrypted under the recovery key |
| `vaults.ct` | the journal, AES-GCM |

The key that opens the wrappers is derived on the device with 310,000 rounds of
PBKDF2 and never sent. Somebody who takes the whole database has ciphertext and
a very expensive guessing problem.

## Why the password is not what is sent

A password sent to the server would let the server decrypt the journal, and then
the encryption would be decoration. So the password is used twice, locally, under
two unrelated salts:

```
password ──PBKDF2(salt A)──> wrapping key ──> opens the data key   (never leaves)
         └─PBKDF2(salt B)──> auth secret  ──> proves who you are   (sent)
```

Neither derivation reveals the other, and neither can be run backwards. The
server stores an scrypt hash of the auth secret, so even that is not recoverable
from the database.

Signing in therefore means: fetch the salt, derive both values, send one, and use
the other on whatever comes back. Two PBKDF2 passes cost about 300ms.

## Why there is no email password reset

A reset link proves you control a mailbox. It does not tell the server what the
data key is, and the server has no way to find out. Anyone who could reset a
password into a working account could also read the journal, which is the exact
property this design exists to prevent.

So a forgotten password is recovered with the recovery key issued at sign-up,
which opens the second wrapper. That is why the sign-up screen refuses to
continue until the box is ticked. Lose both and the journal cannot be opened by
anyone, including whoever runs the server.

## Two devices, one account

Each save states the version it was editing. A save against a stale version is
refused and the newer ciphertext is returned, because the alternative is one
device silently erasing trades entered on the other. The server cannot merge —
it cannot read either side — so the client reloads the newer version.

The check is a single `UPDATE ... WHERE version = $n RETURNING`, so two devices
saving in the same instant cannot both succeed.

## Running it locally

```bash
npm run dev:cloud
```

Serves the app and the API on one port with SQLite standing in for Postgres.
State goes to `.dev-cloud.db`; delete it to start clean.

```bash
npm test
```

Drives the real endpoints and the real browser crypto against SQLite. The tests
assert the things that matter — that a second device can read the journal, that
the stored rows contain no readable trace of it, and that a stale save is
refused — rather than that the endpoints return 200.

## Limits worth knowing

- The data key is held in `sessionStorage`, so a refresh keeps you signed in and
  closing the tab does not. That is deliberate; the alternative is writing the
  key to disk.
- Sessions last 30 days. Changing the password ends all of them.
- Email addresses are not verified. Nothing is ever sent to them.
