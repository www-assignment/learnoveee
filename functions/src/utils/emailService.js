/**
 * utils/emailService.js
 * Learnove — Nodemailer transactional email utility.
 *
 * Credentials from environment variables (.env):
 *   EMAIL_SERVICE=gmail
 *   EMAIL_USER=your@gmail.com
 *   EMAIL_PASS=your-app-password
 *   EMAIL_FROM_NAME=Learnove
 *   FRONTEND_URL=https://your-domain.com
 */

'use strict';

const nodemailer = require('nodemailer');

// ─── Transporter (lazy-initialised) ──────────────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    pool: true,
    maxConnections: 5,
    rateDelta: 1000,
    rateLimit: 5
  });
  return _transporter;
}

// ─── Base styles ──────────────────────────────────────────────────────────────
const BASE_STYLES = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Nunito',Arial,sans-serif;background:#f0e8f8;color:#321d47}
  .wrap{max-width:600px;margin:0 auto;padding:32px 16px}
  .card{background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 8px 32px rgba(100,50,150,.15)}
  .header{background:linear-gradient(135deg,#b06fd0,#8090e0,#80b8f0);padding:36px 32px;text-align:center}
  .header-logo{font-family:Arial,sans-serif;font-size:28px;font-weight:900;color:#fff;letter-spacing:4px;margin-bottom:4px}
  .header-sub{color:rgba(255,255,255,.8);font-size:13px;letter-spacing:2px}
  .body{padding:36px 32px}
  .greeting{font-size:20px;font-weight:700;color:#321d47;margin-bottom:16px}
  .text{font-size:15px;color:#5a4a6a;line-height:1.7;margin-bottom:16px}
  .btn-wrap{text-align:center;margin:28px 0}
  .btn{display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#b06fd0,#80b8f0);color:#fff;text-decoration:none;border-radius:30px;font-weight:700;font-size:15px;letter-spacing:.5px}
  .fallback-url{background:#f8f4ff;border-radius:10px;padding:12px 16px;font-size:12px;color:#7a5a9a;word-break:break-all;margin:16px 0}
  .divider{height:1px;background:linear-gradient(90deg,transparent,rgba(176,111,208,.3),transparent);margin:24px 0}
  .footer{padding:24px 32px;text-align:center;background:#faf8ff}
  .footer-text{font-size:12px;color:#9a8aaa;line-height:1.6}
  .footer-text a{color:#b06fd0;text-decoration:none}
  .warning-box{background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:12px 16px;font-size:13px;color:#856404;margin:16px 0}
  .success-box{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:10px;padding:12px 16px;font-size:13px;color:#1b5e20;margin:16px 0}
  @media(max-width:480px){.body,.footer{padding:24px 20px}}
</style>`;

function buildHtml(body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${BASE_STYLES}</head><body>${body}</body></html>`;
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// ─── Templates ────────────────────────────────────────────────────────────────
function getTemplate(template, data) {
  const year        = new Date().getFullYear();
  const frontendUrl = process.env.FRONTEND_URL || 'https://learnove.com';

  switch (template) {

    case 'emailVerification':
      return buildHtml(`
        <div class="wrap"><div class="card">
          <div class="header">
            <div class="header-logo">LEARNOVE</div>
            <div class="header-sub">online &amp; physical · unified university</div>
          </div>
          <div class="body">
            <div class="greeting">Welcome, ${escHtml(data.name)}! 🎉</div>
            <p class="text">You're almost there! Please verify your email to activate your Learnove account.</p>
            <div class="btn-wrap"><a href="${data.verificationUrl}" class="btn">✅ Verify My Email</a></div>
            <p class="text" style="text-align:center;font-size:13px">Or copy this link into your browser:</p>
            <div class="fallback-url">${escHtml(data.verificationUrl)}</div>
            <div class="warning-box">⏰ This link expires in <strong>24 hours</strong>.</div>
            <div class="divider"></div>
            <p class="text" style="font-size:13px;color:#9a8aaa">If you didn't create a Learnove account, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p class="footer-text">© ${year} Learnove · <a href="${frontendUrl}/pages/privacy.html">Privacy Policy</a> · <a href="${frontendUrl}/pages/terms.html">Terms of Service</a><br>This is an automated message, please do not reply.</p>
          </div>
        </div></div>`);

    case 'passwordReset':
      return buildHtml(`
        <div class="wrap"><div class="card">
          <div class="header">
            <div class="header-logo">LEARNOVE</div>
            <div class="header-sub">Password Reset Request</div>
          </div>
          <div class="body">
            <div class="greeting">Hi ${escHtml(data.name)},</div>
            <p class="text">We received a request to reset your Learnove password. Click below to choose a new one.</p>
            <div class="btn-wrap"><a href="${data.resetUrl}" class="btn">🔐 Reset My Password</a></div>
            <p class="text" style="text-align:center;font-size:13px">Or copy this link:</p>
            <div class="fallback-url">${escHtml(data.resetUrl)}</div>
            <div class="warning-box">⏰ This link expires in <strong>1 hour</strong> for security reasons.</div>
            <div class="divider"></div>
            <p class="text" style="font-size:13px;color:#9a8aaa">If you didn't request this, please ignore the email — your password remains unchanged.</p>
          </div>
          <div class="footer">
            <p class="footer-text">© ${year} Learnove · <a href="${frontendUrl}/pages/privacy.html">Privacy Policy</a><br>This is an automated security email.</p>
          </div>
        </div></div>`);

    case 'welcome':
      return buildHtml(`
        <div class="wrap"><div class="card">
          <div class="header">
            <div class="header-logo">LEARNOVE</div>
            <div class="header-sub">Your journey begins now 🚀</div>
          </div>
          <div class="body">
            <div class="greeting">You're in, ${escHtml(data.name)}! 🎓</div>
            <p class="text">Your email has been verified and your Learnove account is fully active. Welcome to the community!</p>
            <div class="success-box">✅ Your account is now verified and ready to use!</div>
            <div class="btn-wrap"><a href="${frontendUrl}/pages/dashboard.html" class="btn">🎯 Go to My Dashboard</a></div>
            <div class="divider"></div>
            <p class="text" style="font-size:13px;text-align:center">Questions? <a href="mailto:support@learnove.com" style="color:#b06fd0;font-weight:700">support@learnove.com</a></p>
          </div>
          <div class="footer"><p class="footer-text">© ${year} Learnove. All rights reserved.</p></div>
        </div></div>`);

    default:
      return buildHtml(`<div class="wrap"><p>${escHtml(data.message || 'A message from Learnove')}</p></div>`);
  }
}

// ─── Public send function ─────────────────────────────────────────────────────
exports.sendEmail = async (options) => {
  const fromName = process.env.EMAIL_FROM_NAME || 'Learnove';
  const fromAddr = process.env.EMAIL_USER;

  const html = getTemplate(options.template, options.data || {});
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const msg = {
    from:    `"${fromName}" <${fromAddr}>`,
    to:      options.email,
    subject: options.subject,
    html,
    text
  };

  const info = await getTransporter().sendMail(msg);
  console.log('Email sent:', { to: options.email, msgId: info.messageId });
  return info;
};