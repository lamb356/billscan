/**
 * BillScan Email System
 *
 * Minimal SMTP client using Node.js net/tls modules.
 * Falls back to console logging in dev mode.
 */

import net from 'node:net';
import tls from 'node:tls';

const EMAIL_HOST = process.env.EMAIL_HOST || '';
const EMAIL_PORT = Number(process.env.EMAIL_PORT) || 587;
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@billscan.app';
const IS_DEV = !EMAIL_HOST;

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// ─── SMTP send ───────────────────────────────────────────────────────────────

function smtpCommand(socket: net.Socket | tls.TLSSocket, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer) => {
      socket.removeListener('data', onData);
      resolve(data.toString());
    };
    socket.on('data', onData);
    socket.write(cmd + '\r\n', (err) => {
      if (err) reject(err);
    });
    setTimeout(() => { socket.removeListener('data', onData); reject(new Error('SMTP timeout')); }, 10000);
  });
}

function waitForGreeting(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer) => {
      socket.removeListener('data', onData);
      resolve(data.toString());
    };
    socket.on('data', onData);
    setTimeout(() => { socket.removeListener('data', onData); reject(new Error('SMTP greeting timeout')); }, 10000);
  });
}

async function sendViaSMTP(msg: EmailMessage): Promise<void> {
  const socket = net.createConnection(EMAIL_PORT, EMAIL_HOST);

  await waitForGreeting(socket);
  await smtpCommand(socket, `EHLO billscan`);

  // STARTTLS if port 587
  if (EMAIL_PORT === 587) {
    await smtpCommand(socket, 'STARTTLS');
    const tlsSocket = tls.connect({ socket, host: EMAIL_HOST, servername: EMAIL_HOST });
    await new Promise<void>((resolve, reject) => {
      tlsSocket.on('secureConnect', resolve);
      tlsSocket.on('error', reject);
    });
    await smtpCommand(tlsSocket, `EHLO billscan`);
    // Auth
    const credentials = Buffer.from(`\0${EMAIL_USER}\0${EMAIL_PASS}`).toString('base64');
    await smtpCommand(tlsSocket, `AUTH PLAIN ${credentials}`);
    await smtpCommand(tlsSocket, `MAIL FROM:<${EMAIL_FROM}>`);
    await smtpCommand(tlsSocket, `RCPT TO:<${msg.to}>`);
    await smtpCommand(tlsSocket, 'DATA');
    const email = [
      `From: BillScan <${EMAIL_FROM}>`,
      `To: ${msg.to}`,
      `Subject: ${msg.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="billscan-boundary"',
      '',
      '--billscan-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      msg.text,
      '',
      '--billscan-boundary',
      'Content-Type: text/html; charset=utf-8',
      '',
      msg.html,
      '',
      '--billscan-boundary--',
    ].join('\r\n');
    await smtpCommand(tlsSocket, email + '\r\n.');
    await smtpCommand(tlsSocket, 'QUIT');
    tlsSocket.destroy();
  } else {
    // Plain SMTP (port 25)
    const credentials = Buffer.from(`\0${EMAIL_USER}\0${EMAIL_PASS}`).toString('base64');
    if (EMAIL_USER) await smtpCommand(socket, `AUTH PLAIN ${credentials}`);
    await smtpCommand(socket, `MAIL FROM:<${EMAIL_FROM}>`);
    await smtpCommand(socket, `RCPT TO:<${msg.to}>`);
    await smtpCommand(socket, 'DATA');
    const email = [
      `From: BillScan <${EMAIL_FROM}>`,
      `To: ${msg.to}`,
      `Subject: ${msg.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      msg.html,
    ].join('\r\n');
    await smtpCommand(socket, email + '\r\n.');
    await smtpCommand(socket, 'QUIT');
    socket.destroy();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (IS_DEV) {
    console.log(`[email] DEV MODE — would send to: ${msg.to}`);
    console.log(`[email] Subject: ${msg.subject}`);
    console.log(`[email] Text: ${msg.text.slice(0, 200)}...`);
    return;
  }

  try {
    await sendViaSMTP(msg);
    console.log(`[email] Sent to ${msg.to}: ${msg.subject}`);
  } catch (err) {
    console.error(`[email] Failed to send to ${msg.to}:`, err);
    throw err;
  }
}

// ─── Email templates ─────────────────────────────────────────────────────────

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const HEADER = `<div style="background:#0d1117;padding:24px 32px;text-align:center">
  <span style="color:#3fb950;font-size:24px;font-weight:700">BillScan</span>
</div>`;

const FOOTER = `<div style="padding:20px 32px;font-size:12px;color:#8b949e;text-align:center;border-top:1px solid #30363d">
  <p>BillScan is a transparency tool, not legal or medical advice. All rates from official CMS.gov data.</p>
  <p><a href="${APP_URL}" style="color:#58a6ff">billscan.app</a></p>
</div>`;

function wrap(content: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#010409;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d">
${HEADER}
<div style="padding:32px;color:#e6edf3;line-height:1.6">
${content}
</div>
${FOOTER}
</div></body></html>`;
}

export function welcomeEmail(email: string): EmailMessage {
  return {
    to: email,
    subject: 'Welcome to BillScan',
    html: wrap(`
      <h2 style="color:#e6edf3;margin-top:0">Welcome to BillScan!</h2>
      <p>You've taken the first step toward understanding your medical bills.</p>
      <p>BillScan compares your charges against official Medicare rates to find potential overcharges. Here's how to get started:</p>
      <ol>
        <li><strong>Upload a bill</strong> — PDF, image, or JSON</li>
        <li><strong>Review findings</strong> — see line-by-line comparisons</li>
        <li><strong>Take action</strong> — generate appeal letters, dispute letters, or phone scripts</li>
      </ol>
      <p style="text-align:center;margin-top:24px">
        <a href="${APP_URL}/#/audit" style="display:inline-block;background:#3fb950;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Audit Your First Bill</a>
      </p>
    `),
    text: `Welcome to BillScan!\n\nYou've taken the first step toward understanding your medical bills.\n\nBillScan compares your charges against official Medicare rates to find potential overcharges.\n\n1. Upload a bill (PDF, image, or JSON)\n2. Review findings\n3. Take action with appeal letters, dispute letters, or phone scripts\n\nGet started: ${APP_URL}/#/audit`,
  };
}

export function auditSummaryEmail(email: string, savings: number, findingCount: number, reportId: string): EmailMessage {
  return {
    to: email,
    subject: `Your BillScan Audit: $${savings.toFixed(2)} in potential savings found`,
    html: wrap(`
      <h2 style="color:#e6edf3;margin-top:0">Your Audit Results</h2>
      <div style="background:#0d1117;border-radius:8px;padding:20px;margin:16px 0;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#3fb950">$${savings.toFixed(2)}</div>
        <div style="color:#8b949e;font-size:14px">potential savings across ${findingCount} finding${findingCount !== 1 ? 's' : ''}</div>
      </div>
      <p>Your bill has been analyzed against official CMS Medicare rates. We found potential overcharges that you may be able to dispute.</p>
      <p><strong>Next steps:</strong></p>
      <ul>
        <li>Download your appeal letter</li>
        <li>Check charity care eligibility</li>
        <li>Generate a phone script for your insurance</li>
      </ul>
      <p style="text-align:center;margin-top:24px">
        <a href="${APP_URL}/#/audit" style="display:inline-block;background:#3fb950;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Run Another Audit</a>
      </p>
      <p style="font-size:12px;color:#8b949e">Report ID: ${reportId}</p>
    `),
    text: `Your BillScan Audit Results\n\nPotential savings: $${savings.toFixed(2)} across ${findingCount} finding(s).\n\nYour bill has been analyzed against official CMS Medicare rates. We found potential overcharges that you may be able to dispute.\n\nNext steps:\n- Download your appeal letter\n- Check charity care eligibility\n- Generate a phone script\n\nRun another audit: ${APP_URL}/#/audit\n\nReport ID: ${reportId}`,
  };
}

export function upgradeConfirmationEmail(email: string): EmailMessage {
  return {
    to: email,
    subject: 'Welcome to BillScan Premium',
    html: wrap(`
      <h2 style="color:#e6edf3;margin-top:0">Welcome to Premium!</h2>
      <p>Thank you for upgrading to BillScan Premium. You now have access to:</p>
      <ul>
        <li><strong>Unlimited audits</strong> — no monthly cap</li>
        <li><strong>Appeal letters</strong> — professionally formatted dispute documents</li>
        <li><strong>Dispute letters</strong> — ready-to-send letters to your provider</li>
        <li><strong>Phone scripts</strong> — guided scripts for insurance calls</li>
        <li><strong>PDF export</strong> — printable audit reports</li>
        <li><strong>Bulk upload</strong> — audit multiple bills at once</li>
      </ul>
      <p style="text-align:center;margin-top:24px">
        <a href="${APP_URL}/#/audit" style="display:inline-block;background:#3fb950;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Start Auditing</a>
      </p>
    `),
    text: `Welcome to BillScan Premium!\n\nYou now have access to unlimited audits, appeal letters, dispute letters, phone scripts, PDF export, and bulk upload.\n\nStart auditing: ${APP_URL}/#/audit`,
  };
}

export function passwordResetEmail(email: string, resetToken: string): EmailMessage {
  const resetUrl = `${APP_URL}/#/reset-password?token=${resetToken}`;
  return {
    to: email,
    subject: 'Reset your BillScan password',
    html: wrap(`
      <h2 style="color:#e6edf3;margin-top:0">Password Reset</h2>
      <p>We received a request to reset your password. Click the button below to choose a new password:</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${resetUrl}" style="display:inline-block;background:#3fb950;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
      </p>
      <p style="font-size:13px;color:#8b949e">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      <p style="font-size:12px;color:#8b949e;word-break:break-all">Direct link: ${resetUrl}</p>
    `),
    text: `BillScan Password Reset\n\nWe received a request to reset your password. Visit this link to choose a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
  };
}

export function auditResultsEmail(email: string, savings: number, findingCount: number): EmailMessage {
  return {
    to: email,
    subject: `Your BillScan Audit: $${savings.toFixed(2)} in potential savings`,
    html: wrap(`
      <h2 style="color:#e6edf3;margin-top:0">Your Audit Results Are Ready</h2>
      <div style="background:#0d1117;border-radius:8px;padding:20px;margin:16px 0;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#3fb950">$${savings.toFixed(2)}</div>
        <div style="color:#8b949e;font-size:14px">potential savings across ${findingCount} finding${findingCount !== 1 ? 's' : ''}</div>
      </div>
      <p>Your medical bill has been analyzed against official CMS Medicare rates.</p>
      <p>Log in to BillScan to review your results, generate appeal letters, and take action.</p>
      <p style="text-align:center;margin-top:24px">
        <a href="${APP_URL}/#/audit" style="display:inline-block;background:#3fb950;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">View Results</a>
      </p>
    `),
    text: `Your BillScan Audit Results\n\nPotential savings: $${savings.toFixed(2)} across ${findingCount} finding(s).\n\nLog in to BillScan to review your results and take action.\n\n${APP_URL}/#/audit`,
  };
}

export function weeklyDigestEmail(
  email: string,
  stats: { totalAudits: number; totalSavings: number; newFeatures?: string[] },
): EmailMessage {
  const features = stats.newFeatures?.length
    ? `<h3 style="color:#e6edf3">What's New</h3><ul>${stats.newFeatures.map(f => `<li>${f}</li>`).join('')}</ul>`
    : '';
  return {
    to: email,
    subject: 'Your BillScan Weekly Update',
    html: wrap(`
      <h2 style="color:#e6edf3;margin-top:0">Weekly Digest</h2>
      <div style="background:#0d1117;border-radius:8px;padding:20px;margin:16px 0">
        <div style="display:flex;justify-content:space-around;text-align:center">
          <div>
            <div style="font-size:28px;font-weight:700;color:#3fb950">${stats.totalAudits}</div>
            <div style="color:#8b949e;font-size:12px">audits this week</div>
          </div>
          <div>
            <div style="font-size:28px;font-weight:700;color:#3fb950">$${stats.totalSavings.toFixed(2)}</div>
            <div style="color:#8b949e;font-size:12px">total savings found</div>
          </div>
        </div>
      </div>
      ${features}
      <p>Keep auditing your bills to find more savings!</p>
      <p style="text-align:center;margin-top:24px">
        <a href="${APP_URL}/#/audit" style="display:inline-block;background:#3fb950;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Audit a Bill</a>
      </p>
    `),
    text: `BillScan Weekly Digest\n\nAudits this week: ${stats.totalAudits}\nTotal savings found: $${stats.totalSavings.toFixed(2)}\n\n${stats.newFeatures?.length ? 'What\'s New:\n' + stats.newFeatures.map(f => `- ${f}`).join('\n') : ''}\n\nAudit a bill: ${APP_URL}/#/audit`,
  };
}
