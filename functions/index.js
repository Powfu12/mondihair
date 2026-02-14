const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Bird SMS config from environment variables (.env file)
const BIRD_CONFIG = {
  accessKey: process.env.BIRD_ACCESS_KEY,
  workspaceId: process.env.BIRD_WORKSPACE_ID,
  channelId: process.env.BIRD_CHANNEL_ID,
  businessPhone: process.env.BIRD_BUSINESS_PHONE || '+306974628335'
};

// Format Greek phone number to E.164 (+30XXXXXXXXXX)
function formatGreekPhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0030')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('30') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 10) return '+30' + cleaned;
  if (cleaned.length === 12 && cleaned.startsWith('30')) return '+' + cleaned;
  return null;
}

// Send SMS via Bird API
async function sendSMS(to, message) {
  const formattedPhone = formatGreekPhone(to);
  if (!formattedPhone) throw new Error('Invalid phone number: ' + to);

  // Log config to verify env vars are loaded
  console.log(`SMS to: ${formattedPhone}, accessKey set: ${!!BIRD_CONFIG.accessKey}, workspace: ${BIRD_CONFIG.workspaceId}, channel: ${BIRD_CONFIG.channelId}`);

  if (!BIRD_CONFIG.accessKey) throw new Error('BIRD_ACCESS_KEY env variable is not set');
  if (!BIRD_CONFIG.workspaceId) throw new Error('BIRD_WORKSPACE_ID env variable is not set');
  if (!BIRD_CONFIG.channelId) throw new Error('BIRD_CHANNEL_ID env variable is not set');

  const url = `https://api.bird.com/workspaces/${BIRD_CONFIG.workspaceId}/channels/${BIRD_CONFIG.channelId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `AccessKey ${BIRD_CONFIG.accessKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receiver: {
        contacts: [{ identifierValue: formattedPhone }]
      },
      body: {
        type: 'text',
        text: { text: message }
      }
    })
  });

  const responseText = await response.text();
  console.log(`Bird API response: status=${response.status}, body=${responseText}`);

  if (response.status === 202 || response.ok) {
    const data = JSON.parse(responseText);
    return { success: true, id: data.id };
  } else {
    throw new Error(`Bird API error ${response.status}: ${responseText}`);
  }
}

// Scheduled function: runs every 5 minutes, checks for bookings ~2 hours away
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

        const message = `🔔 Υπενθύμιση Ραντεβού\n\nΈχετε ραντεβού σε 2 ώρες:\n\n📅 ${dateStr}\n🕐 ${booking.timeSlot} με ${booking.barberName}\n\n⏰ Παρακαλούμε να είστε εκεί 5 λεπτά νωρίτερα.\n\nΓια ακύρωση: ${BIRD_CONFIG.businessPhone}\n\nMondi Hairstyle`;

        try {
          await sendSMS(booking.customerPhone, message);
          await db.collection('bookings').doc(booking.id).update({
            reminderSent: true,
            reminderSentAt: new Date()
          });
          sentCount++;
          console.log(`Reminder sent for booking ${booking.id} at ${booking.timeSlot} to ${booking.customerPhone}`);
        } catch (error) {
          console.error(`Failed to send reminder for ${booking.id}:`, error.message);
        }
      }
    }

    console.log(`Done. Sent ${sentCount} reminders.`);
  }
);
