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
  console.log('Vonage initialized successfully');
} else {
  console.log('Vonage credentials not configured. API Key:', apiKey ? 'SET' : 'MISSING', 'API Secret:', apiSecret ? 'SET' : 'MISSING');
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
    console.error('Vonage not configured - check firebase functions:config');
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

    // Remove the + for Vonage API
    const phoneForVonage = formattedPhone.replace('+', '');

    console.log('Sending SMS to:', phoneForVonage, 'from:', fromNumber);
    console.log('Message:', message.substring(0, 50) + '...');

    // Vonage SDK v3 SMS send
    const response = await vonage.sms.send({
      to: phoneForVonage,
      from: fromNumber,
      text: message
    });

    console.log('Vonage response:', JSON.stringify(response));

    // Check response - Vonage v3 returns messages array
    if (response && response.messages && response.messages.length > 0) {
      const msg = response.messages[0];
      if (msg.status === '0' || msg.status === 0) {
        console.log('SMS sent successfully! Message ID:', msg['message-id']);
        return { success: true, messageId: msg['message-id'] };
      } else {
        console.error('Vonage SMS error - Status:', msg.status, 'Error:', msg['error-text']);
        return { success: false, error: msg['error-text'] || 'Unknown error' };
      }
    } else if (response && response.messageUuid) {
      // Alternative response format
      console.log('SMS sent successfully! UUID:', response.messageUuid);
      return { success: true, messageId: response.messageUuid };
    } else {
      console.log('Unexpected response format:', JSON.stringify(response));
      // Assume success if no error thrown
      return { success: true, messageId: 'unknown' };
    }
  } catch (error) {
    console.error('Error sending SMS:', error.message);
    console.error('Full error:', JSON.stringify(error, null, 2));
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
    console.log('=== 2-Hour Reminder Check Started ===');

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
    const results = [];

    for (const dateStr of dates) {
      console.log('Checking bookings for date:', dateStr);

      const snapshot = await db.collection('bookings')
        .where('date', '==', dateStr)
        .where('status', 'in', ['confirmed', 'pending'])
        .get();

      console.log(`Found ${snapshot.size} bookings for ${dateStr}`);

      for (const doc of snapshot.docs) {
        const booking = doc.data();

        if (booking.reminderSent) {
          console.log(`Skipping ${doc.id} - reminder already sent`);
          continue;
        }

        const [bookingHour, bookingMinute] = booking.timeSlot.split(':').map(Number);
        const bookingTimeMinutes = bookingHour * 60 + bookingMinute;
        const timeDiff = Math.abs(bookingTimeMinutes - targetTimeMinutes);

        console.log(`Booking ${doc.id}: ${booking.timeSlot}, diff: ${timeDiff} minutes`);

        if (timeDiff <= 5) {
          console.log(`Sending 2-hour reminder for booking ${doc.id} at ${booking.timeSlot}`);

          const message = `Υπενθύμιση: Το ραντεβού σας είναι σε 2 ώρες!

${booking.customerName}, σας περιμένουμε στις ${booking.timeSlot} για ${booking.service}.

Mondi Hairstyle
Ακύρωση: ${businessPhone}`;

          const result = await sendSMS(booking.customerPhone, message);
          results.push({ bookingId: doc.id, result });

          if (result.success) {
            await doc.ref.update({
              reminderSent: true,
              reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Reminder sent and marked for ${doc.id}`);
          }
        }
      }
    }

    console.log(`=== Reminder check complete. Sent ${results.length} reminders ===`);
    return null;
  });

// ============================================
// BOOKING CONFIRMATION SMS
// ============================================
exports.sendBookingConfirmationSMS = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const bookingId = context.params.bookingId;
    console.log('=== New booking created:', bookingId, '===');

    const booking = snap.data();
    console.log('Booking data:', JSON.stringify(booking));

    if (!booking.customerPhone) {
      console.log('No phone number provided, skipping SMS');
      return null;
    }

    const message = `Επιβεβαίωση Ραντεβού

${booking.customerName}, το ραντεβού σας:
${booking.date} στις ${booking.timeSlot}
${booking.service}

Θα σας στείλουμε υπενθύμιση 2 ώρες πριν.

Mondi Hairstyle
Ακύρωση: ${businessPhone}`;

    console.log('Sending confirmation SMS to:', booking.customerPhone);
    const result = await sendSMS(booking.customerPhone, message);
    console.log('SMS result:', JSON.stringify(result));

    if (result.success) {
      await snap.ref.update({
        smsSent: true,
        smsSentAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log('Booking updated with smsSent=true');
    } else {
      await snap.ref.update({
        smsError: result.error
      });
      console.log('Booking updated with smsError');
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
      console.log('=== Booking cancelled:', context.params.bookingId, '===');

      if (!after.customerPhone) {
        console.log('No phone number, skipping cancellation SMS');
        return null;
      }

      const message = `Ακύρωση Ραντεβού

${after.customerName}, το ραντεβού σας για ${after.date} στις ${after.timeSlot} ακυρώθηκε.

Για νέο ραντεβού: mondihairstyle.gr

Mondi Hairstyle`;

      const result = await sendSMS(after.customerPhone, message);
      console.log('Cancellation SMS result:', JSON.stringify(result));
    }

    return null;
  });

// ============================================
// TEST FUNCTION - Call manually to test SMS
// ============================================
exports.testSMS = functions.https.onRequest(async (req, res) => {
  const phone = req.query.phone || '+306974628335';
  const message = 'Test SMS from Mondi Hairstyle - ' + new Date().toISOString();

  console.log('Testing SMS to:', phone);
  const result = await sendSMS(phone, message);

  res.json({
    vonageConfigured: vonage !== null,
    apiKey: apiKey ? 'SET' : 'MISSING',
    apiSecret: apiSecret ? 'SET' : 'MISSING',
    from: fromNumber,
    result: result
  });
});
