/**
 * Sending two kinds of email: a password-reset link, and the congratulations
 * when a friend a member invited pays their first month (referrals.js).
 *
 * Over Brevo's HTTP API rather than SMTP, and with fetch rather than a client
 * library, for the same reason the rest of this codebase has almost no
 * dependencies: a POST to one URL is the whole protocol, and a serverless
 * function that has to open an SMTP connection on a cold start is slower and
 * more fragile than one that does not.
 *
 * Brevo's free tier is 300 messages a day, which is far more than this will
 * ever need, and it will send from a single verified address without owning a
 * domain — the thing that rules out most of the alternatives for an app living
 * on a *.vercel.app subdomain.
 *
 * Everything is optional. With no API key configured, mailAvailable() is false
 * and the app offers recovery keys instead, exactly as it did before.
 */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export function mailAvailable() {
  return !!(process.env.MAIL_API_KEY && process.env.MAIL_FROM);
}

/**
 * Deliver the reset link.
 *
 * Throws on failure. The caller is expected to swallow it: whether the mail
 * went out is not something the response is allowed to reveal, because "no mail
 * was sent" answers the question of whether an address has an account here.
 */
export async function sendResetEmail(to, link) {
  if (!mailAvailable()) throw new Error('No mail provider is configured.');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': process.env.MAIL_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        email: process.env.MAIL_FROM,
        name: process.env.MAIL_FROM_NAME || 'Clavis',
      },
      to: [{ email: to }],
      subject: 'Reset your Clavis password',
      // Both parts, because a text/plain alternative is one of the cheapest
      // things that keeps a message out of a spam folder.
      textContent: [
        'Someone asked to reset the password on your Clavis account.',
        '',
        'Open this link to choose a new one:',
        link,
        '',
        'The link works once and expires in 45 minutes.',
        'If this was not you, ignore this email — nothing has changed.',
      ].join('\n'),
      htmlContent: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a">
          <p>Someone asked to reset the password on your Clavis account.</p>
          <p style="margin:24px 0">
            <a href="${escapeAttribute(link)}"
               style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;display:inline-block">
              Choose a new password
            </a>
          </p>
          <p style="color:#666;font-size:13px">
            The link works once and expires in 45 minutes.<br>
            If this was not you, ignore this email — nothing has changed.
          </p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mail provider refused the message (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/**
 * The referral reward (November 2026): a friend who joined with this
 * member's code has paid their first month, and the member gets a free month.
 * Throws on failure; the caller carries on regardless, since the message is
 * also waiting in the app.
 */
export async function sendReferralRewardEmail(to, friend, months = 1, link = '') {
  if (!mailAvailable()) throw new Error('No mail provider is configured.');
  const who = friend || 'A friend you invited';
  const gift = months === 1 ? 'a free month' : `${months} free months`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': process.env.MAIL_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'Clavis' },
      to: [{ email: to }],
      subject: `Congratulations: ${who} joined Clavis, you get ${gift}`,
      textContent: [
        'Congratulations!',
        '',
        `${who} joined Clavis with your referral code and has just paid for their first month.`,
        `As a thank you, you get ${gift} of Clavis.`,
        '',
        'You will see it in your profile, under Invite friends.',
        link ? `Open Clavis: ${link}` : '',
        '',
        'Thank you for sharing Clavis.',
      ].join('\n'),
      htmlContent: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:520px">
          <p style="font-size:20px;font-weight:700;margin:0 0 12px">Congratulations!</p>
          <p><b>${escapeAttribute(who)}</b> joined Clavis with your referral code and has just paid for their first month.</p>
          <p>As a thank you, you get <b>${escapeAttribute(gift)}</b> of Clavis.</p>
          ${link ? `<p style="margin:24px 0"><a href="${escapeAttribute(link)}" style="background:#F26A1E;color:#0B0F16;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:999px;display:inline-block">Open Clavis</a></p>` : ''}
          <p style="color:#666;font-size:13px">You will see it in your profile, under Invite friends. Thank you for sharing Clavis.</p>
        </div>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mail provider refused the message (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/** The link is built by us, but it still goes into an attribute. */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
