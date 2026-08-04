const nodemailer = require('nodemailer');

function configured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendEnquiryNotification(enquiry) {
  if (!configured()) return { skipped: true };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const safe = value => String(value || '').replace(/[<>]/g, '');
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    subject: `New website enquiry: ${safe(enquiry.name)}`,
    text: [
      `Name: ${safe(enquiry.name)}`, `Phone: ${safe(enquiry.phone)}`,
      `Email: ${safe(enquiry.email)}`, `City: ${safe(enquiry.city)}`,
      `Country: ${safe(enquiry.interestedCountry)}`, `NEET score: ${safe(enquiry.neetScore)}`,
      `Message: ${safe(enquiry.message)}`, `Source: ${safe(enquiry.source)}`
    ].join('\n')
  });
  return { skipped: false };
}
module.exports = { sendEnquiryNotification };
