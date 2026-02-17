const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Brevo API key stored in Firebase Secret Manager
// Set with: firebase functions:secrets:set BREVO_API_KEY
const brevoApiKey = defineSecret('BREVO_API_KEY');

const BREVO_SENDER = {
  email: 'reply@mondihairstyle.com',
  name: 'Mondi Hairstyle'
};
const BUSINESS_PHONE = '+306974628335';

// Send email via Brevo API
async function sendEmail(apiKey, to, subject, htmlContent) {
  console.log(`Sending email to: ${to}, subject: ${subject}`);

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: BREVO_SENDER,
      to: [{ email: to }],
      subject: subject,
      htmlContent: htmlContent
    })
  });

  const responseText = await response.text();
  console.log(`Brevo response: status=${response.status}, body=${responseText}`);

  if (response.ok) {
    const data = JSON.parse(responseText);
    return { success: true, messageId: data.messageId };
  } else {
    throw new Error(`Brevo error ${response.status}: ${responseText}`);
  }
}

// Build confirmation email HTML
function buildConfirmationHtml(booking, dateStr) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a2e; color: #ffffff; border-radius: 12px; overflow: hidden;">
      <div style="background: #C3E321; padding: 20px; text-align: center;">
        <h1 style="margin: 0; color: #1a1a2e; font-size: 22px;">Mondi Hairstyle</h1>
      </div>
      <div style="padding: 25px;">
        <h2 style="color: #C3E321; margin-top: 0;">Επιβεβαίωση Ραντεβού</h2>
        <p>Γεια σας <strong>${booking.customerName}</strong>!</p>
        <p>Το ραντεβού σας επιβεβαιώθηκε:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <tr><td style="padding: 8px 0; color: #aaa;">Ημερομηνία</td><td style="padding: 8px 0; font-weight: bold;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #aaa;">Ωρα</td><td style="padding: 8px 0; font-weight: bold;">${booking.timeSlot}</td></tr>
          <tr><td style="padding: 8px 0; color: #aaa;">Κομμωτής</td><td style="padding: 8px 0; font-weight: bold;">${booking.barberName}</td></tr>
          <tr><td style="padding: 8px 0; color: #aaa;">Υπηρεσία</td><td style="padding: 8px 0; font-weight: bold;">${booking.service}</td></tr>
        </table>
        <p style="color: #aaa; font-size: 13px;">Για ακύρωση καλέστε: ${BUSINESS_PHONE}</p>
      </div>
      <div style="background: #111; padding: 15px; text-align: center; color: #666; font-size: 12px;">
        Mondi Hairstyle - Zakynthos
      </div>
    </div>`;
}

// Build reminder email HTML
function buildReminderHtml(booking, dateStr) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a2e; color: #ffffff; border-radius: 12px; overflow: hidden;">
      <div style="background: #C3E321; padding: 20px; text-align: center;">
        <h1 style="margin: 0; color: #1a1a2e; font-size: 22px;">Mondi Hairstyle</h1>
      </div>
      <div style="padding: 25px;">
        <h2 style="color: #C3E321; margin-top: 0;">Υπενθύμιση Ραντεβού</h2>
        <p>Γεια σας <strong>${booking.customerName}</strong>!</p>
        <p>Έχετε ραντεβού σε <strong>2 ώρες</strong>:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <tr><td style="padding: 8px 0; color: #aaa;">Ημερομηνία</td><td style="padding: 8px 0; font-weight: bold;">${dateStr}</td></tr>
          <tr><td style="padding: 8px 0; color: #aaa;">Ωρα</td><td style="padding: 8px 0; font-weight: bold;">${booking.timeSlot}</td></tr>
          <tr><td style="padding: 8px 0; color: #aaa;">Κομμωτής</td><td style="padding: 8px 0; font-weight: bold;">${booking.barberName}</td></tr>
        </table>
        <p style="color: #C3E321;">Παρακαλούμε να είστε εκεί 5 λεπτά νωρίτερα.</p>
        <p style="color: #aaa; font-size: 13px;">Για ακύρωση καλέστε: ${BUSINESS_PHONE}</p>
      </div>
      <div style="background: #111; padding: 15px; text-align: center; color: #666; font-size: 12px;">
        Mondi Hairstyle - Zakynthos
      </div>
    </div>`;
}

// HTTP endpoint: booking page calls this to send confirmation email
exports.sendConfirmation = onRequest(
  {
    region: 'europe-west1',
    secrets: [brevoApiKey],
    cors: true
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const booking = req.body;

    if (!booking.customerEmail) {
      res.json({ success: false, error: 'No email address' });
      return;
    }

    try {
      const date = new Date(booking.date + 'T00:00:00');
      const dateStr = date.toLocaleDateString('el-GR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const subject = 'Επιβεβαίωση Ραντεβού - Mondi Hairstyle';
      const htmlContent = buildConfirmationHtml(booking, dateStr);

      const result = await sendEmail(brevoApiKey.value(), booking.customerEmail, subject, htmlContent);
      res.json(result);
    } catch (error) {
      console.error('Failed to send confirmation:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Scheduled function: runs every 5 minutes, sends reminder emails ~2 hours before
exports.sendReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Europe/Athens',
    region: 'europe-west1',
    secrets: [brevoApiKey]
  },
  async () => {
    const now = new Date();

    // Get current time in Greek timezone
    const greekParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Athens',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);

    const year = greekParts.find(p => p.type === 'year').value;
    const month = greekParts.find(p => p.type === 'month').value;
    const day = greekParts.find(p => p.type === 'day').value;
    const hour = parseInt(greekParts.find(p => p.type === 'hour').value);
    const minute = parseInt(greekParts.find(p => p.type === 'minute').value);

    const todayStr = `${year}-${month}-${day}`;
    const currentMinutes = hour * 60 + minute;

    console.log(`Checking reminders at ${todayStr} ${hour}:${String(minute).padStart(2, '0')} (Europe/Athens)`);

    const snapshot = await db.collection('bookings')
      .where('date', '==', todayStr)
      .where('status', 'in', ['confirmed', 'pending'])
      .get();

    let sentCount = 0;

    for (const doc of snapshot.docs) {
      const booking = { id: doc.id, ...doc.data() };

      if (booking.reminderSent) continue;
      if (!booking.customerEmail) {
        console.log(`Skipping ${booking.id}: no email address`);
        continue;
      }

      const [bookingHour, bookingMinute] = booking.timeSlot.split(':').map(Number);
      const bookingMinutes = bookingHour * 60 + bookingMinute;
      const minutesUntilAppointment = bookingMinutes - currentMinutes;

      // Send reminder when appointment is 90-150 minutes away (1.5h to 2.5h)
      if (minutesUntilAppointment >= 90 && minutesUntilAppointment <= 150) {
        const date = new Date(booking.date + 'T00:00:00');
        const dateStr = date.toLocaleDateString('el-GR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        });

        const subject = 'Υπενθύμιση Ραντεβού σε 2 ώρες - Mondi Hairstyle';
        const htmlContent = buildReminderHtml(booking, dateStr);

        try {
          await sendEmail(brevoApiKey.value(), booking.customerEmail, subject, htmlContent);
          await db.collection('bookings').doc(booking.id).update({
            reminderSent: true,
            reminderSentAt: new Date()
          });
          sentCount++;
          console.log(`Reminder sent for booking ${booking.id} at ${booking.timeSlot} to ${booking.customerEmail}`);
        } catch (error) {
          console.error(`Failed to send reminder for ${booking.id}:`, error.message);
        }
      }
    }

    console.log(`Done. Sent ${sentCount} reminders.`);
  }
);
