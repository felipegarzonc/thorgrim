// Sending email, through Resend (resend.com). Set RESEND_API_KEY and
// MAIL_FROM (e.g. "Thorgrim <thorgrim@yourdomain.com>", a domain verified in
// Resend) in the hosting settings. Without them nothing is sent, and callers
// fall back to showing the admin what to send.

export const mailReady = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim());

export async function sendMail(m: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  if (!mailReady()) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM!.trim(), to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!res.ok) console.error(`Email to ${m.to} failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    return res.ok;
  } catch (e) {
    console.error(`Email to ${m.to} failed:`, e);
    return false;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
