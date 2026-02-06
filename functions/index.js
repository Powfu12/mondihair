const functions = require('firebase-functions');
const admin = require('firebase-admin');
const twilio = require('twilio');

admin.initializeApp();

// Initialize Twilio - set these with: firebase functions:config:set twilio.account_sid="xxx" twilio.auth_token="xxx" twilio.alpha_sender="MondiHair"
const accountSid = functions.config().twilio?.account_sid;
const authToken = functions.config().twilio?.auth_token;
const alphaSender = functions.config().twilio?.alpha_sender || 'MondiHair';
const businessPhone = functions.config().twilio?.business_phone || '+35799123456';

let twilioClient = null;
if (accountSid && authToken) {
  twilioClient = twilio(accountSid, authToken);
}

// Helper function to send SMS
async function sendSMS(to, message) {
  if (!twilioClient) {
    console.error('Twilio not configured');
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    // Format phone number
    let formattedPhone = to.replace(/\s/g, '');
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+357' + formattedPhone.replace(/^0+/, '');
    }

    const result = await twilioClient.messages.create({
      body: message,
      from: alphaSender,
      to: formattedPhone
    });

    console.log('SMS sent successfully:', result.sid);
    return { success: true, sid: result.sid };
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
    const now = new Date();

    // Calculate 2 hours from now
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // Format today's date as YYYY-MM-DD
    const todayStr = now.toISOString().split('T')[0];
    const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Target time (2 hours from now)
    const targetHour = twoHoursLater.getHours();
    const targetMinute = twoHoursLater.getMinutes();
    const targetTimeMinutes = targetHour * 60 + targetMinute;

    console.log(`Checking for 2-hour reminders. Now: ${now.toISOString()}, Target time: ${targetHour}:${targetMinute}`);

    // Get bookings for today and tomorrow (in case it's late evening)
    const dates = [todayStr];
    if (twoHoursLater.toISOString().split('T')[0] !== todayStr) {
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

        // Skip if reminder already sent
        if (booking.reminderSent) {
          return;
        }

        // Parse booking time
        const [bookingHour, bookingMinute] = booking.timeSlot.split(':').map(Number);
        const bookingTimeMinutes = bookingHour * 60 + bookingMinute;

        // Check if booking is approximately 2 hours from now (within 5 minute window)
        // This accounts for the 10-minute cron interval
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

    // Only send if we have a phone number
    if (!booking.customerPhone) {
      console.log('No phone number, skipping SMS');
      return null;
    }

    const message = `Επιβεβαίωση Ραντεβού

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

    // Only send if status changed to cancelled
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
