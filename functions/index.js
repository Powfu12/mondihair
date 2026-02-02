const functions = require('firebase-functions');
const https = require('https');

// Vonage SMS Configuration
// These should be set via: firebase functions:config:set vonage.api_key="xxx" vonage.api_secret="xxx"
const VONAGE_CONFIG = {
  apiKey: functions.config().vonage?.api_key || 'efacae61',
  apiSecret: functions.config().vonage?.api_secret || 'DtkFOZIjgzSola2s',
  alphaSender: 'MondiHair',
  businessPhone: '+306974628335'
};

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
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      api_key: VONAGE_CONFIG.apiKey,
      api_secret: VONAGE_CONFIG.apiSecret,
      from: VONAGE_CONFIG.alphaSender,
      to: to,
      text: message,
      type: 'unicode'
    });

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
        try {
          const response = JSON.parse(data);
          if (response.messages && response.messages[0]) {
            const msg = response.messages[0];
            if (msg.status === '0') {
              resolve({ success: true, messageId: msg['message-id'] });
            } else {
              reject(new Error(msg['error-text'] || 'SMS sending failed'));
            }
          } else {
            reject(new Error('Invalid response from Vonage'));
          }
        } catch (e) {
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
exports.sendSMS = functions.https.onCall(async (data, context) => {
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
exports.onBookingCreated = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();

    // Skip if no phone number
    if (!booking.customerPhone) {
      console.log('No phone number for booking, skipping SMS');
      return null;
    }

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

    const message = `Epivevaiosi Rantevou

Geia sas ${booking.customerName}!

To rantevou sas epivevaiotike:

${dateStr}
${booking.timeSlot}
Kommotis: ${booking.barberName}
Ypiresia: ${booking.service}

Gia akyrosi: ${VONAGE_CONFIG.businessPhone}

Mondi Hairstyle`;

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
