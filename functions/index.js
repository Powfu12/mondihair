const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Vonage } = require('@vonage/server-sdk');

admin.initializeApp();

// Initialize Vonage - set these with:
// firebase functions:config:set vonage.api_key="xxx" vonage.api_secret="xxx" vonage.from="MondiHair"
const apiKey = functions.config().vonage?.api_key;
const apiSecret = functions.config().vonage?.api_secret;
const fromNumber = functions.config().vonage?.from || 'MondiHair';
const businessPhone = functions.config().vonage?.business_phone || '+306974628335';

let vonage = null;
if (apiKey && apiSecret) {
  vonage = new Vonage({
    apiKey: apiKey,
    apiSecret: apiSecret
  });
}

// Helper function to get current time in Greek timezone
function getGreekTime() {
  const now = new Date();
  const greekTimeStr = now.toLocaleString('en-US', { timeZone: 'Europe/Athens' });
  return new Date(greekTimeStr);
}

// Helper function to format date as YYYY-MM-DD in Greek timezone
function formatDateGreek(date) {
  const greekDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
  const year = greekDate.getFullYear();
  const month = String(greekDate.getMonth() + 1).padStart(2, '0');
  const day = String(greekDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper function to send SMS via Vonage
async function sendSMS(to, message) {
  if (!vonage) {
    console.error('Vonage not configured');
    return { success: false, error: 'Vonage not configured' };
  }

  try {
    // Format phone number for Greece
    let formattedPhone = to.replace(/\s/g, '').replace(/-/g, '');
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.startsWith('00')) {
        formattedPhone = '+' + formattedPhone.substring(2);
      } else if (formattedPhone.startsWith('0')) {
        formattedPhone = '+30' + formattedPhone.substring(1);
      } else if (formattedPhone.startsWith('30')) {
        formattedPhone = '+' + formattedPhone;
      } else {
        formattedPhone = '+30' + formattedPhone;
      }
    }

    console.log('Sending SMS to:', formattedPhone);

    const response = await vonage.sms.send({
      to: formattedPhone.replace('+', ''),
      from: fromNumber,
      text: message
    });

    if (response.messages[0].status === '0') {
      console.log('SMS sent successfully:', response.messages[0]['message-id']);
      return { success: true, messageId: response.messages[0]['message-id'] };
    } else {
      console.error('Vonage error:', response.messages[0]['error-text']);
      return { success: false, error: response.messages[0]['error-text'] };
    }
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// 2-HOUR REMINDER - Runs every 10 minutes
// ============================================
exports.send2HourReminders = functions.pubsub
  .schedule('every 10 minutes')
  .timeZone('Europe/Athens')
  .onRun(async (context) => {
    const nowGreek = getGreekTime();
    const twoHoursLater = new Date(nowGreek.getTime() + 2 * 60 * 60 * 1000);

    const todayStr = formatDateGreek(nowGreek);
    const tomorrowGreek = new Date(nowGreek.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = formatDateGreek(tomorrowGreek);

    const targetHour = twoHoursLater.getHours();
    const targetMinute = twoHoursLater.getMinutes();
    const targetTimeMinutes = targetHour * 60 + targetMinute;

    console.log(`[Greek Time] Now: ${nowGreek.toLocaleString()}, Target: ${targetHour}:${String(targetMinute).padStart(2, '0')}, Date: ${todayStr}`);

    const dates = [todayStr];
    const twoHoursLaterDateStr = formatDateGreek(twoHoursLater);
    if (twoHoursLaterDateStr !== todayStr) {
      dates.push(tomorrowStr);
    }

    const db = admin.firestore();
    const promises = [];

    for (const dateStr of dates) {
      const snapshot = await db.collection('bookings')
        .where('date', '==', dateStr)
        .where('status', 'in', ['confirmed', 'pending'])
        .get();

      snapshot.forEach(doc => {
        const booking = doc.data();

        if (booking.reminderSent) {
          return;
        }

        const [bookingHour, bookingMinute] = booking.timeSlot.split(':').map(Number);
        const bookingTimeMinutes = bookingHour * 60 + bookingMinute;
        const timeDiff = Math.abs(bookingTimeMinutes - targetTimeMinutes);

        if (timeDiff <= 5) {
          console.log(`Sending 2-hour reminder for booking ${doc.id} at ${booking.timeSlot}`);

          const message = `Υπενθύμιση Ραντεβού - 2 ώρες!

Γεια σας ${booking.customerName}!

Το ραντεβού σας είναι σε 2 ώρες:
${booking.timeSlot} - ${booking.service}
Κομμωτής: ${booking.barberName || booking.barberId}

Σας περιμένουμε!
Mondi Hairstyle

Για ακύρωση: ${businessPhone}`;

          promises.push(
            sendSMS(booking.customerPhone, message)
              .then(result => {
                if (result.success) {
                  return doc.ref.update({
                    reminderSent: true,
                    reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
                  });
                }
              })
              .catch(err => console.error(`Reminder failed for ${doc.id}:`, err))
          );
        }
      });
    }

    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`Sent ${promises.length} 2-hour reminder(s)`);
    } else {
      console.log('No 2-hour reminders needed');
    }

    return null;
  });

// ============================================
// BOOKING CONFIRMATION SMS
// ============================================
exports.sendBookingConfirmationSMS = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();

    if (!booking.customerPhone) {
      console.log('No phone number, skipping SMS');
      return null;
    }

    const message = `Επιβεβαίωση Ραντεβού ✓

Γεια σας ${booking.customerName}!

Το ραντεβού σας:
${booking.date} στις ${booking.timeSlot}
${booking.service}
Κομμωτής: ${booking.barberName || booking.barberId}

Θα λάβετε υπενθύμιση 2 ώρες πριν.

Mondi Hairstyle
Για ακύρωση: ${businessPhone}`;

    const result = await sendSMS(booking.customerPhone, message);

    if (result.success) {
      await snap.ref.update({
        smsSent: true,
        smsSentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return null;
  });

// ============================================
// BOOKING CANCELLATION SMS
// ============================================
exports.sendBookingCancellationSMS = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.status !== 'cancelled' && after.status === 'cancelled') {
      if (!after.customerPhone) {
        return null;
      }

      const message = `Ακύρωση Ραντεβού

Γεια σας ${after.customerName},

Το ραντεβού σας για ${after.date} στις ${after.timeSlot} έχει ακυρωθεί.

Για νέο ραντεβού επισκεφθείτε την ιστοσελίδα μας.

Mondi Hairstyle`;

      await sendSMS(after.customerPhone, message);
    }

    return null;
  });
