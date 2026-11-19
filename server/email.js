/* Email sending. EMAIL_PROVIDER=brevo or =resend sends real mail; =console logs it and keeps a dev inbox.
   Brevo works with a verified sender address and no domain. Resend needs a verified domain. */
'use strict';

const PROVIDER = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
const FROM = process.env.EMAIL_FROM || 'Block Game <noreply@example.com>';
const GAME = process.env.GAME_NAME || 'Block Game';
const devInbox = [];

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function render(subject, body, link, linkText) {
  const text = body + (link ? `\n\n${linkText || 'Open link'}: ${link}` : '') + `\n\n${GAME}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#eef0f4;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1d26">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d3d7e1;border-radius:10px;padding:28px">
<p style="margin:0 0 16px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7a5d00;font-weight:700">${escapeHtml(GAME)}</p>
<h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(subject)}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#3a3f4d">${escapeHtml(body).replace(/\n/g, '<br>')}</p>
${link ? `<p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#f2cf1d;color:#0b1020;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px">${escapeHtml(linkText || 'Open link')}</a></p>
<p style="margin:0;font-size:13px;color:#5b6070;word-break:break-all">If the button does not work, copy this link: ${escapeHtml(link)}</p>` : ''}
</div></body></html>`;
  return { text, html };
}

async function send({ to, subject, body, link, linkText }) {
  const { text, html } = render(subject, body, link, linkText);
  if (PROVIDER === 'brevo') {
    const key = process.env.BREVO_API_KEY;
    if (!key) throw new Error('BREVO_API_KEY is not set');
    const m = FROM.match(/^(.*?)\s*<([^>]+)>$/);
    const sender = m ? { name: m[1].trim() || GAME, email: m[2].trim() } : { name: GAME, email: FROM.trim() };
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html })
    });
    if (!r.ok) throw new Error('Brevo error ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return true;
  }
  if (PROVIDER === 'resend') {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html })
    });
    if (!r.ok) throw new Error('Resend error ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return true;
  }
  // console provider (development)
  devInbox.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), to, subject, body, link: link || null, at: Date.now() });
  if (devInbox.length > 50) devInbox.pop();
  console.log(`[email] to=${to} subject="${subject}"${link ? ' link=' + link : ''}`);
  return true;
}

module.exports = { send, devInbox, PROVIDER };
