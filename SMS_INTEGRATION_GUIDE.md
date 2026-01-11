# SMS Confirmation Integration Guide

This guide explains how to add SMS confirmation notifications to the Mondi Hairstyle booking system.

## 📱 Overview

SMS confirmations will automatically send text messages to customers when:
- ✅ A new booking is created
- ✅ A booking is confirmed by the barber
- ⏰ 24 hours before the appointment (reminder)
- ❌ A booking is cancelled

---

## 🔧 SMS Service Options

### Option 1: Twilio (Recommended)

**Pros:**
- Most popular and reliable
- Pay-as-you-go pricing (~€0.06 per SMS in Europe)
- Excellent documentation
- Free trial credit

**Pricing:**
- €0.06 per SMS in Cyprus
- No monthly fees (pay as you go)
- First €10-15 free trial credit

**Setup Steps:**

1. **Create Twilio Account**
   - Go to: https://www.twilio.com/try-twilio
   - Sign up for free trial
   - Verify your phone number

2. **Get Credentials**
   - From Twilio Console, get:
     - Account SID
     - Auth Token
     - Buy a phone number (Cyprus: +357)

3. **Install Twilio SDK**
   ```bash
   npm install twilio
   ```

### Option 2: Vonage (formerly Nexmo)

**Pros:**
- Competitive pricing
- Good for international SMS
- Simple API

**Pricing:**
- €0.04-0.07 per SMS
- Free trial credit

### Option 3: AWS SNS (Amazon Simple Notification Service)

**Pros:**
- Very cheap if already using AWS
- Scales automatically
- Part of AWS free tier

**Pricing:**
- €0.02-0.06 per SMS
- First 100 SMS free each month

---

## 🚀 Implementation: Twilio + Firebase Cloud Functions

The best approach is to use Firebase Cloud Functions to send SMS messages. This keeps your API keys secure on the server.

### Step 1: Set Up Firebase Cloud Functions

1. **Install Firebase CLI** (if not already done):
   ```bash
   npm install -g firebase-tools
   ```

2. **Initialize Cloud Functions**:
   ```bash
   firebase login
   firebase init functions
   ```
   - Select TypeScript or JavaScript
   - Install dependencies when prompted

3. **Install Twilio in Functions Directory**:
   ```bash
   cd functions
   npm install twilio
   ```

### Step 2: Configure Environment Variables

Store your Twilio credentials securely:

```bash
firebase functions:config:set twilio.account_sid="YOUR_ACCOUNT_SID"
firebase functions:config:set twilio.auth_token="YOUR_AUTH_TOKEN"
firebase functions:config:set twilio.phone_number="+357XXXXXXXXX"
```

### Step 3: Create Cloud Function

Create/edit `functions/index.js` (or `index.ts`):

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const twilio = require('twilio');

admin.initializeApp();

// Initialize Twilio
const accountSid = functions.config().twilio.account_sid;
const authToken = functions.config().twilio.auth_token;
const twilioPhoneNumber = functions.config().twilio.phone_number;
const client = twilio(accountSid, authToken);

// Function to send SMS
async function sendSMS(to, message) {
  try {
    const result = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: to
    });
    console.log('SMS sent successfully:', result.sid);
    return result;
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

// Trigger: When a new booking is created
exports.sendBookingConfirmationSMS = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();

    // Format phone number (ensure it starts with country code)
    let phoneNumber = booking.customerPhone;
    if (!phoneNumber.startsWith('+')) {
      // Assume Cyprus number if no country code
      phoneNumber = '+357' + phoneNumber.replace(/^0+/, '');
    }

    // Create confirmation message in Greek
    const message = `
Γεια σας ${booking.customerName}!

Το ραντεβού σας επιβεβαιώθηκε:
📅 ${formatDate(booking.date)}
🕐 ${booking.timeSlot}
✂️ ${booking.service}
👨‍🦰 Κομμωτής: ${booking.barberName}

Mondi Hairstyle
Τηλ: +357 99 123456
    `.trim();

    try {
      await sendSMS(phoneNumber, message);

      // Update booking document to mark SMS sent
      await snap.ref.update({
        smsSent: true,
        smsSentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to send SMS:', error);
      // Don't fail the booking if SMS fails
    }
  });

// Trigger: When booking status changes to confirmed
exports.sendBookingStatusSMS = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();

    // Only send SMS if status changed to confirmed or cancelled
    if (oldData.status === newData.status) return null;

    let phoneNumber = newData.customerPhone;
    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+357' + phoneNumber.replace(/^0+/, '');
    }

    let message = '';

    if (newData.status === 'confirmed' && oldData.status === 'pending') {
      message = `
Γεια σας ${newData.customerName}!

Το ραντεβού σας επιβεβαιώθηκε από τον κομμωτή!
📅 ${formatDate(newData.date)} στις ${newData.timeSlot}
✂️ ${newData.service}

Mondi Hairstyle
      `.trim();
    } else if (newData.status === 'cancelled') {
      message = `
Γεια σας ${newData.customerName},

Το ραντεβού σας για ${formatDate(newData.date)} στις ${newData.timeSlot} ακυρώθηκε.

Για νέο ραντεβού: +357 99 123456

Mondi Hairstyle
      `.trim();
    }

    if (message) {
      try {
        await sendSMS(phoneNumber, message);
      } catch (error) {
        console.error('Failed to send status SMS:', error);
      }
    }

    return null;
  });

// Scheduled function: Send reminders 24 hours before appointment
exports.sendDailyReminders = functions.pubsub
  .schedule('every day 10:00')
  .timeZone('Europe/Athens')
  .onRun(async (context) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Get all confirmed bookings for tomorrow
    const snapshot = await admin.firestore()
      .collection('bookings')
      .where('date', '==', tomorrowStr)
      .where('status', '==', 'confirmed')
      .get();

    const promises = [];

    snapshot.forEach(doc => {
      const booking = doc.data();

      let phoneNumber = booking.customerPhone;
      if (!phoneNumber.startsWith('+')) {
        phoneNumber = '+357' + phoneNumber.replace(/^0+/, '');
      }

      const message = `
Υπενθύμιση Ραντεβού 📅

Γεια σας ${booking.customerName}!

Έχετε ραντεβού αύριο:
🕐 ${booking.timeSlot}
✂️ ${booking.service}
👨‍🦰 ${booking.barberName}

Σας περιμένουμε!
Mondi Hairstyle
      `.trim();

      promises.push(
        sendSMS(phoneNumber, message)
          .then(() => {
            return doc.ref.update({
              reminderSent: true,
              reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
            });
          })
          .catch(err => console.error('Reminder failed:', err))
      );
    });

    await Promise.all(promises);
    console.log(`Sent ${promises.length} reminder SMS`);
    return null;
  });

// Helper function to format date in Greek
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const options = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  return date.toLocaleDateString('el-GR', options);
}
```

### Step 4: Deploy Cloud Functions

```bash
firebase deploy --only functions
```

This will deploy:
- `sendBookingConfirmationSMS` - Sends SMS when booking is created
- `sendBookingStatusSMS` - Sends SMS when booking status changes
- `sendDailyReminders` - Runs daily at 10:00 AM to send 24h reminders

---

## 📝 SMS Message Templates

### Booking Confirmation (Greek)
```
Γεια σας [Name]!

Το ραντεβού σας επιβεβαιώθηκε:
📅 [Date]
🕐 [Time]
✂️ [Service]
👨‍🦰 Κομμωτής: [Barber]

Mondi Hairstyle
Τηλ: +357 99 123456
```

### 24-Hour Reminder
```
Υπενθύμιση Ραντεβού 📅

Γεια σας [Name]!

Έχετε ραντεβού αύριο:
🕐 [Time]
✂️ [Service]
👨‍🦰 [Barber]

Σας περιμένουμε!
Mondi Hairstyle
```

### Cancellation Notice
```
Γεια σας [Name],

Το ραντεβού σας για [Date] στις [Time] ακυρώθηκε.

Για νέο ραντεβού: +357 99 123456

Mondi Hairstyle
```

---

## 💰 Cost Estimates

### Twilio Pricing for Cyprus

Based on 100 bookings per month:
- 100 confirmation SMS: €6.00
- 100 reminder SMS: €6.00
- Total: **~€12/month**

### Reducing Costs

1. **Only send essentials**: Skip reminder for same-day bookings
2. **Combine messages**: Send one SMS instead of two
3. **SMS only for confirmed**: Don't send for pending bookings
4. **Use email for reminders**: Keep SMS for confirmations only

---

## 🧪 Testing

### Test Mode with Twilio Trial

During trial, you can only send SMS to verified phone numbers:

1. Verify your phone in Twilio Console
2. Test the system by making a booking with your verified number
3. Check that SMS arrives correctly
4. Upgrade account when ready for production

### Local Testing

```bash
# In functions directory
npm run serve

# This starts a local emulator
# Trigger functions manually to test
```

---

## 🔒 Security Best Practices

1. **Never expose credentials in frontend code**
   - Use Cloud Functions for all SMS operations
   - Store credentials in Firebase Config

2. **Validate phone numbers**
   - Check format before sending
   - Use international format (+357...)

3. **Rate limiting**
   - Prevent spam by limiting SMS per customer
   - Add cooldown between messages

4. **Privacy compliance**
   - Get consent for SMS notifications
   - Add opt-out mechanism
   - Follow GDPR guidelines

---

## 🚨 Troubleshooting

### SMS Not Sending

1. **Check Twilio Console**
   - Go to Logs to see error messages
   - Verify phone number format

2. **Check Firebase Functions Logs**
   ```bash
   firebase functions:log
   ```

3. **Common Issues**
   - Phone number format incorrect (must include +357)
   - Twilio trial limitations (only verified numbers)
   - Insufficient Twilio credit

### Phone Number Format Issues

Cyprus phone numbers can be tricky. Use this helper:

```javascript
function formatCyprusPhone(phone) {
  // Remove spaces and dashes
  phone = phone.replace(/[\s-]/g, '');

  // If starts with 00357, replace with +357
  if (phone.startsWith('00357')) {
    return '+' + phone.substring(2);
  }

  // If starts with 357, add +
  if (phone.startsWith('357')) {
    return '+' + phone;
  }

  // If starts with 0, replace with +357
  if (phone.startsWith('0')) {
    return '+357' + phone.substring(1);
  }

  // If no country code, assume Cyprus
  if (!phone.startsWith('+')) {
    return '+357' + phone;
  }

  return phone;
}
```

---

## ✅ Checklist

- [ ] Sign up for Twilio account
- [ ] Verify your phone number (for testing)
- [ ] Buy a Cyprus phone number (+357)
- [ ] Install Firebase CLI
- [ ] Initialize Cloud Functions
- [ ] Install Twilio in functions directory
- [ ] Set environment variables
- [ ] Copy cloud function code
- [ ] Deploy functions
- [ ] Test with your verified number
- [ ] Update booking form to get customer consent
- [ ] Add SMS opt-out mechanism
- [ ] Monitor costs in Twilio dashboard
- [ ] Upgrade from trial when ready for production

---

## 💡 Alternative: Simpler Approach Without Cloud Functions

If you want to avoid Cloud Functions, you can use a backend service:

### Option A: Use Zapier/Make.com

1. Create a Zap/Scenario that watches Firestore
2. When new booking is created → Send SMS via Twilio
3. No code required, but monthly subscription

### Option B: Simple Backend Script

Create a small Node.js server that:
1. Listens for Firestore changes
2. Sends SMS via Twilio
3. Can run on Heroku free tier or any hosting

---

## 📚 Additional Resources

- [Twilio SMS Documentation](https://www.twilio.com/docs/sms)
- [Firebase Cloud Functions Guide](https://firebase.google.com/docs/functions)
- [Twilio Pricing for Cyprus](https://www.twilio.com/sms/pricing/cy)
- [Firebase Functions Samples](https://github.com/firebase/functions-samples)

---

## 🎯 Quick Start Summary

1. **Sign up for Twilio** → Get Account SID, Auth Token, Phone Number
2. **Set up Firebase Functions** → `firebase init functions`
3. **Add Twilio credentials** → `firebase functions:config:set`
4. **Copy the code above** → Paste into `functions/index.js`
5. **Deploy** → `firebase deploy --only functions`
6. **Test** → Create a booking with your verified number

That's it! Your booking system will now send SMS confirmations automatically.
