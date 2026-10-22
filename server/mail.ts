// Sending email: through Resend (RESEND_API_KEY and MAIL_FROM, with a domain
// verified in Resend) or, with no domain of your own, through a Gmail account
// (GMAIL_USER and GMAIL_APP_PASSWORD, an app password from
// myaccount.google.com/apppasswords). Set them in the hosting settings.
// Without either nothing is sent, and callers show the admin what to send.

import nodemailer from "nodemailer";

const resend = () => (process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim() ? { key: process.env.RESEND_API_KEY.trim(), from: process.env.MAIL_FROM.trim() } : null);
const gmail = () =>
  process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim()
    ? { user: process.env.GMAIL_USER.trim(), pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") }
    : null;

export const mailReady = () => Boolean(resend() || gmail());

export async function sendMail(m: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  try {
    const r = resend();
    if (r) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${r.key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: r.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      });
      if (!res.ok) console.error(`Email to ${m.to} failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      return res.ok;
    }
    const g = gmail();
    if (g) {
      const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: g.user, pass: g.pass } });
      await transport.sendMail({ from: `Thorgrim <${g.user}>`, to: m.to, subject: m.subject, text: m.text, html: m.html });
      return true;
    }
    return false;
  } catch (e) {
    console.error(`Email to ${m.to} failed:`, e);
    return false;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
