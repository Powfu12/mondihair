const functions = require('firebase-functions');
const admin = require('firebase-admin');
const https = require('https');

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Set region to Europe (Belgium - closest to Greece)
const euFunctions = functions.region('europe-west1');

// Vonage SMS Configuration
const VONAGE_CONFIG = {
  apiKey: process.env.VONAGE_API_KEY || 'efacae61',
  apiSecret: process.env.VONAGE_API_SECRET || 'DtkFOZIjgzSola2s',
  alphaSender: 'MondiHair',
  businessPhone: '+306974628335'
};

console.log('Cloud Functions loaded. Vonage API Key:', VONAGE_CONFIG.apiKey ? 'SET' : 'NOT SET');

/**
 * Format Greek phone number to E.164 format (without + prefix for Vonage)
 */
function formatGreekPhone(phone) {
  if (!phone) return null;

  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Handle different formats
  if (cleaned.startsWith('00300')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('0030')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('300')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('30')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Should be 10 digits now (Greek number without country code)
  if (cleaned.length === 10) {
    return '30' + cleaned;
  }

  // If it's already 12 digits (30 + 10 digits)
  if (cleaned.length === 12 && cleaned.startsWith('30')) {
    return cleaned;
  }

  return null;
}

/**
 * Send SMS via Vonage API
 */
function sendVonageSMS(to, message) {
  console.log('sendVonageSMS called - To:', to);
  console.log('Using API Key:', VONAGE_CONFIG.apiKey);
  console.log('Using Sender:', VONAGE_CONFIG.alphaSender);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      api_key: VONAGE_CONFIG.apiKey,
      api_secret: VONAGE_CONFIG.apiSecret,
      from: VONAGE_CONFIG.alphaSender,
      to: to,
      text: message,
      type: 'unicode'
    });

    console.log('Sending request to Vonage...');

    const options = {
      hostname: 'rest.nexmo.com',
      port: 443,
      path: '/sms/json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Vonage raw response:', data);
        try {
          const response = JSON.parse(data);
          console.log('Vonage parsed response:', JSON.stringify(response));
          if (response.messages && response.messages[0]) {
            const msg = response.messages[0];
            console.log('Message status:', msg.status, 'Error:', msg['error-text']);
            if (msg.status === '0') {
              console.log('SMS sent successfully! ID:', msg['message-id']);
              resolve({ success: true, messageId: msg['message-id'] });
            } else {
              console.error('Vonage error:', msg['error-text']);
              reject(new Error(msg['error-text'] || 'SMS sending failed'));
            }
          } else {
            console.error('Invalid Vonage response structure');
            reject(new Error('Invalid response from Vonage'));
          }
        } catch (e) {
          console.error('Failed to parse response:', e.message);
          reject(new Error('Failed to parse Vonage response'));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Cloud Function: Send SMS
 * Called from frontend via Firebase Functions HTTPS callable
 */
exports.sendSMS = euFunctions.https.onCall(async (data, context) => {
  const { to, message, type } = data;

  // Validate input
  if (!to || !message) {
    throw new functions.https.HttpsError('invalid-argument', 'Phone number and message are required');
  }

  // Format phone number
  const formattedPhone = formatGreekPhone(to);
  if (!formattedPhone) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid phone number format');
  }

  try {
    console.log(`Sending ${type || 'SMS'} to: ${formattedPhone}`);
    const result = await sendVonageSMS(formattedPhone, message);
    console.log('SMS sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending SMS:', error.message);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Cloud Function: Send Booking Confirmation SMS
 * Triggered automatically when a new booking is created in Firestore
 */
exports.onBookingCreated = euFunctions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    console.log('=== onBookingCreated TRIGGERED ===');
    console.log('Booking ID:', context.params.bookingId);

    const booking = snap.data();
    console.log('Booking data:', JSON.stringify(booking));

    // Skip if no phone number
    if (!booking.customerPhone) {
      console.log('No phone number for booking, skipping SMS');
      return null;
    }

    console.log('Customer phone:', booking.customerPhone);

    const formattedPhone = formatGreekPhone(booking.customerPhone);
    if (!formattedPhone) {
      console.log('Invalid phone number format, skipping SMS');
      return null;
    }

    // Format date in Greek
    const date = new Date(booking.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('el-GR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const message = `MONDI HAIRSTYLE
Επιβεβαίωση Ραντεβού

Αγαπητέ/ή ${booking.customerName},

Το ραντεβού σας έχει επιβεβαιωθεί:

Ημερομηνία: ${dateStr}
Ώρα: ${booking.timeSlot}
Κομμωτής: ${booking.barberName}
Υπηρεσία: ${booking.service}

Για αλλαγή ή ακύρωση, καλέστε μας:
${VONAGE_CONFIG.businessPhone}

Σας ευχαριστούμε που μας επιλέξατε!`;

    try {
      const result = await sendVonageSMS(formattedPhone, message);
      console.log('Confirmation SMS sent:', result.messageId);

      // Update booking to mark SMS as sent
      await snap.ref.update({
        smsSent: true,
        smsSentAt: new Date()
      });

      return result;
    } catch (error) {
      console.error('Failed to send confirmation SMS:', error.message);
      return null;
    }
  });

/**
 * Cloud Function: Send 2-Hour Reminder SMS
 * Runs every 15 minutes to check for upcoming appointments
 */
exports.sendReminders = euFunctions.pubsub
  .schedule('every 15 minutes')
  .timeZone('Europe/Athens')
  .onRun(async (context) => {
    console.log('=== sendReminders TRIGGERED ===');

    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const twoHoursAndFifteenMins = new Date(now.getTime() + 2.25 * 60 * 60 * 1000);

    // Get today's date in YYYY-MM-DD format (Athens timezone)
    const athensDate = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });

    console.log('Checking for bookings on:', athensDate);
    console.log('Current time (Athens):', now.toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens' }));

    try {
      // Query bookings for today that haven't received a reminder
      const bookingsSnapshot = await db.collection('bookings')
        .where('date', '==', athensDate)
        .where('status', '==', 'confirmed')
        .get();

      console.log('Found', bookingsSnapshot.size, 'bookings for today');

      const reminderPromises = [];

      for (const doc of bookingsSnapshot.docs) {
        const booking = doc.data();

        // Skip if reminder already sent
        if (booking.reminderSent) {
          continue;
        }

        // Skip if no phone number
        if (!booking.customerPhone) {
          continue;
        }

        // Parse booking time (format: "HH:MM" or "HH:MM - HH:MM")
        const timeMatch = booking.timeSlot.match(/(\d{1,2}):(\d{2})/);
        if (!timeMatch) {
          console.log('Could not parse time slot:', booking.timeSlot);
          continue;
        }

        const bookingHour = parseInt(timeMatch[1]);
        const bookingMinute = parseInt(timeMatch[2]);

        // Create booking datetime in Athens timezone
        const bookingDate = new Date(booking.date + 'T00:00:00');
        bookingDate.setHours(bookingHour, bookingMinute, 0, 0);

        // Check if booking is within the 2-hour reminder window (between 1h45m and 2h15m from now)
        const timeDiff = bookingDate.getTime() - now.getTime();
        const minutesUntilBooking = timeDiff / (60 * 1000);

        console.log(`Booking ${doc.id}: ${booking.timeSlot}, minutes until: ${minutesUntilBooking.toFixed(0)}`);

        // Send reminder if booking is between 105 and 135 minutes away (1h45m - 2h15m)
        if (minutesUntilBooking >= 105 && minutesUntilBooking <= 135) {
          console.log('Sending reminder for booking:', doc.id);

          const formattedPhone = formatGreekPhone(booking.customerPhone);
          if (!formattedPhone) {
            console.log('Invalid phone format for:', booking.customerPhone);
            continue;
          }

          const message = `MONDI HAIRSTYLE
Υπενθύμιση Ραντεβού

Αγαπητέ/ή ${booking.customerName},

Σας υπενθυμίζουμε ότι έχετε ραντεβού σε 2 ώρες:

Ώρα: ${booking.timeSlot}
Κομμωτής: ${booking.barberName}
Υπηρεσία: ${booking.service}

Παρακαλούμε να έρθετε 5 λεπτά νωρίτερα.

Για αλλαγή ή ακύρωση:
${VONAGE_CONFIG.businessPhone}

Σας περιμένουμε!`;

          reminderPromises.push(
            sendVonageSMS(formattedPhone, message)
              .then(async (result) => {
                console.log('Reminder sent for booking:', doc.id);
                await doc.ref.update({
                  reminderSent: true,
                  reminderSentAt: new Date()
                });
                return result;
              })
              .catch((error) => {
                console.error('Failed to send reminder for booking:', doc.id, error.message);
                return null;
              })
          );
        }
      }

      const results = await Promise.all(reminderPromises);
      console.log('Reminders sent:', results.filter(r => r !== null).length);

      return null;
    } catch (error) {
      console.error('Error in sendReminders:', error.message);
      return null;
    }
  });
