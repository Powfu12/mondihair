# SMS Confirmation Integration Guide

This guide explains how to add SMS confirmation notifications to the Mondi Hairstyle booking system using **Bird SMS** (formerly MessageBird).

## Overview

SMS confirmations will automatically send text messages to customers when:
- A new booking is created
- A booking is confirmed by the barber
- 2 hours before the appointment (reminder)
- A booking is cancelled

---

## SMS Service: Bird (formerly MessageBird)

**Why Bird:**
- Simple REST API
- Competitive pricing (~€0.05-0.07 per SMS in Europe)
- Alphanumeric sender ID support (shows "MondiHair" instead of a phone number)
- Good European coverage (Greece/Cyprus)
- Dashboard at https://dashboard.bird.com

**Pricing:**
- Pay-as-you-go, no monthly fees
- ~€0.05-0.07 per SMS in Greece/Cyprus
- Free trial credits available

---

## Setup Steps

### Step 1: Create Bird Account

1. Go to https://dashboard.bird.com and sign up
2. When asked **"What integration type are you building?"** select **Notifications** (transactional SMS for booking confirmations/reminders)
3. Complete the onboarding wizard

### Step 2: Get Your API Access Key

1. In the Bird Dashboard, go to **Developers > API access keys**
2. Create a new access key (or use the default one)
3. Copy the access key - you'll need it for the config

### Step 3: Configure the Code

Edit `js/booking-system.js` and replace the placeholder values:

```javascript
const BIRD_CONFIG = {
  accessKey: 'YOUR_BIRD_ACCESS_KEY',    // Paste your API Access Key here
  originator: 'MondiHair',              // Alphanumeric sender name (max 11 chars)
  businessPhone: '+306974628335'        // Your business phone for cancellations
};
```

### Step 4: Test

1. Make a test booking with your own phone number
2. Verify the SMS arrives correctly
3. Check the Bird Dashboard logs for delivery status

---

## How It Works (Current Implementation)

The SMS integration is built directly into `js/booking-system.js`:

### API Endpoint
- **URL:** `https://rest.messagebird.com/messages`
- **Auth:** `AccessKey` header with your Bird API key
- **Format:** JSON body with `originator`, `recipients`, and `body`

### Functions

| Function | Purpose |
|----------|---------|
| `sendSMS(to, message)` | Core function - sends SMS via Bird REST API |
| `sendBookingConfirmation(booking)` | Sends confirmation when booking is created |
| `send2HourReminder(booking)` | Sends reminder 2 hours before appointment |
| `formatGreekPhone(phone)` | Formats phone to E.164 (+30XXXXXXXXXX) |
| `getBookingsNeedingReminder()` | Finds bookings needing 2-hour reminders |
| `markReminderSent(bookingId)` | Marks reminder as sent in Firestore |

### Automatic Reminders
- The admin panel (`admin.html`) runs a scheduler every 5 minutes
- It checks for bookings 2 hours away and sends reminders
- Reminders only send once (tracked via `reminderSent` flag in Firestore)

---

## SMS Message Templates (Greek)

### Booking Confirmation
```
✅ Επιβεβαίωση Ραντεβού

Γεια σας [Name]!

Το ραντεβού σας επιβεβαιώθηκε:

📅 [Date]
🕐 [Time]
💇 Κομμωτής: [Barber]
✂️ Υπηρεσία: [Service]

Για ακύρωση: +306974628335

Mondi Hairstyle
```

### 2-Hour Reminder
```
🔔 Υπενθύμιση Ραντεβού

Έχετε ραντεβού σε 2 ώρες:

📅 [Date]
🕐 [Time] με [Barber]

⏰ Παρακαλούμε να είστε εκεί 5 λεπτά νωρίτερα.

Για ακύρωση: +306974628335

Mondi Hairstyle
```

---

## Cost Estimates

Based on 100 bookings per month:
- 100 confirmation SMS: ~€5-7
- 100 reminder SMS: ~€5-7
- **Total: ~€10-14/month**

### Reducing Costs
1. Skip reminders for same-day bookings
2. Use email for reminders, SMS only for confirmations
3. Combine confirmation + reminder into one message when close

---

## Security Notes

**Current implementation** sends SMS directly from the browser (client-side). This works but exposes the API key in the frontend JavaScript.

**For production**, consider moving SMS sending to Firebase Cloud Functions:

```javascript
// functions/index.js - Bird SMS via Cloud Function
const functions = require('firebase-functions');
const fetch = require('node-fetch');

exports.sendSMS = functions.https.onCall(async (data, context) => {
  const response = await fetch('https://rest.messagebird.com/messages', {
    method: 'POST',
    headers: {
      'Authorization': `AccessKey ${functions.config().bird.access_key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      originator: 'MondiHair',
      recipients: [data.to],
      body: data.message
    })
  });
  return response.json();
});
```

Set the key securely:
```bash
firebase functions:config:set bird.access_key="YOUR_BIRD_ACCESS_KEY"
```

---

## Troubleshooting

### SMS Not Sending
1. Check Bird Dashboard > Logs for error details
2. Verify the API access key is correct
3. Ensure phone number is in E.164 format (+30XXXXXXXXXX)
4. Check that your Bird account has sufficient credits

### Common Bird API Errors
- `2` - Request not allowed (check access key)
- `9` - Missing params (check originator/recipients/body)
- `10` - Invalid originator (must be <= 11 alphanumeric chars)
- `21` - Insufficient balance (top up your account)

### Phone Number Format
Greek numbers must be in E.164 format: `+30` followed by 10 digits.
The `formatGreekPhone()` function handles this automatically.

---

## Checklist

- [ ] Sign up at https://dashboard.bird.com
- [ ] Select "Notifications" as integration type
- [ ] Get your API Access Key from Developers section
- [ ] Replace `YOUR_BIRD_ACCESS_KEY` in `js/booking-system.js`
- [ ] Test with your own phone number
- [ ] Verify SMS delivery in Bird Dashboard logs
- [ ] Monitor costs in Bird Dashboard
- [ ] (Optional) Move to Firebase Cloud Functions for production security

---

## Bird API Reference

- [Bird SMS API Docs](https://docs.bird.com/api/channels/sms)
- [MessageBird REST API](https://developers.messagebird.com/api/sms-messaging/)
- [Dashboard](https://dashboard.bird.com)
