const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Brevo Email Configuration
const BREVO_CONFIG = {
  apiKey: '2tC0rXq7SDGFPsAm',
  senderEmail: 'booking@mondihair.com',
  senderName: 'Mondi Hairstyle',
  businessPhone: '+306974628335'
};

// Send email via Brevo API
async function sendEmail(to, subject, htmlContent) {
  console.log(`Sending email to: ${to}, subject: ${subject}`);

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_CONFIG.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: BREVO_CONFIG.senderName,
        email: BREVO_CONFIG.senderEmail
      },
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

// Scheduled function: runs every 5 minutes, sends reminder emails ~2 hours before
exports.sendReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Europe/Athens',
    region: 'europe-west1'
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

        const subject = `Υπενθύμιση Ραντεβού σε 2 ώρες - Mondi Hairstyle`;

        const htmlContent = `
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
              <p style="color: #aaa; font-size: 13px;">Για ακύρωση καλέστε: ${BREVO_CONFIG.businessPhone}</p>
            </div>
            <div style="background: #111; padding: 15px; text-align: center; color: #666; font-size: 12px;">
              Mondi Hairstyle - Zakynthos
            </div>
          </div>`;

        try {
          await sendEmail(booking.customerEmail, subject, htmlContent);
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
