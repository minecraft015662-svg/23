const nodemailer = require('nodemailer');

const configured = !!process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const transport = configured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

async function sendLicenseMail(to, lic) {
  const brand = process.env.BRAND_NAME || 'Geeken';
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  const kind = lic.type === 'both' ? 'Theme + addons' : 'Theme only';
  const expires = lic.expires_at ? new Date(lic.expires_at).toDateString() : 'Never (lifetime)';
  const text = [
    `Thanks for choosing ${brand}.`,
    '',
    `License key: ${lic.key}`,
    `Type: ${kind}`,
    `Expires: ${expires}`,
    '',
    'Install on your panel server (run as root):',
    `  bash <(curl -s ${base}/install.sh)`,
    '',
    'The license locks to your panel domain the first time you install.',
  ].join('\n');
  if (!transport) {
    console.log(`[mail disabled] To: ${to}\n${text}\n`);
    return false;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject: `Your ${brand} license`, text });
  return true;
}

module.exports = { sendLicenseMail };
