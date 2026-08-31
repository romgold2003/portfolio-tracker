/**
 * Sending one kind of email: a password-reset link.
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
        name: process.env.MAIL_FROM_NAME || 'Riskbook',
      },
      to: [{ email: to }],
      subject: 'Reset your Riskbook password',
      // Both parts, because a text/plain alternative is one of the cheapest
      // things that keeps a message out of a spam folder.
      textContent: [
        'Someone asked to reset the password on your Riskbook account.',
        '',
        'Open this link to choose a new one:',
        link,
        '',
        'The link works once and expires in 45 minutes.',
        'If this was not you, ignore this email — nothing has changed.',
      ].join('\n'),
      htmlContent: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a">
          <p>Someone asked to reset the password on your Riskbook account.</p>
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

/** The link is built by us, but it still goes into an attribute. */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
