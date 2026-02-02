# SMS Confirmation Integration Guide

This guide explains the SMS confirmation system for the Mondi Hairstyle booking system.

## Overview

SMS confirmations automatically send text messages to customers when:
- A new booking is created (confirmation)
- 2 hours before the appointment (reminder)

---

## Current Implementation: Vonage (Nexmo)

The system uses **Vonage** (formerly Nexmo) for SMS delivery with the following features:

- **Alphanumeric Sender ID**: Messages appear from "MondiHair"
- **Unicode Support**: Full Greek character support
- **Greek Phone Number Formatting**: Automatic E.164 format conversion

### Configuration

The SMS configuration is in `js/booking-system.js`:

```javascript
const VONAGE_CONFIG = {
  apiKey: 'your_api_key',           // Your Vonage API Key
  apiSecret: 'your_api_secret',     // Your Vonage API Secret
  alphaSender: 'MondiHair',         // Alphanumeric sender name
  businessPhone: '+306974628335'    // Business phone for cancellations
};
```

### How It Works

1. **Booking Confirmation**: When a customer creates a booking, an SMS is sent immediately with:
   - Appointment date and time
   - Barber name
   - Service type
   - Business phone for cancellations

2. **2-Hour Reminder**: The admin dashboard runs a scheduler that checks every 5 minutes for upcoming appointments and sends reminders 2 hours before.

---

## SMS Message Templates (Greek)

### Booking Confirmation
```
Επιβεβαίωση Ραντεβού

Γεια σας [Name]!

Το ραντεβού σας επιβεβαιώθηκε:

[Date]
[Time]
Κομμωτής: [Barber]
Υπηρεσία: [Service]

Για ακύρωση: +306974628335

Mondi Hairstyle
```

### 2-Hour Reminder
```
Υπενθύμιση Ραντεβού

Έχετε ραντεβού σε 2 ώρες:

[Date]
[Time] με [Barber]

Παρακαλούμε να είστε εκεί 5 λεπτά νωρίτερα.

Για ακύρωση: +306974628335

Mondi Hairstyle
```

---

## Phone Number Formatting

The system automatically formats Greek phone numbers to E.164 format (+30XXXXXXXXXX).

Supported input formats:
- `+30XXXXXXXXXX` (international format)
- `0030XXXXXXXXXX` (with 00 prefix)
- `30XXXXXXXXXX` (country code without +)
- `69XXXXXXXX` (Greek mobile without country code)
- `069XXXXXXXX` (with leading zero)

---

## Vonage Pricing

### Greece SMS Pricing
- Approximately €0.04-0.07 per SMS
- Free trial credit available for new accounts

### Cost Estimate (100 bookings/month)
- 100 confirmation SMS: ~€5.00
- 100 reminder SMS: ~€5.00
- **Total: ~€10/month**

---

## Vonage Account Setup

1. **Create Account**: Go to [dashboard.nexmo.com](https://dashboard.nexmo.com)
2. **Get Credentials**: Navigate to Settings → API settings
3. **Copy API Key and Secret**: Update in `js/booking-system.js`

---

## Testing

### Trial Account Limitations
- Vonage trial accounts may have limitations on sending SMS
- Test with your own phone number first
- Add credit to your account for production use

### Console Logs
Check browser console for SMS status:
- `Sending SMS to: +30XXXXXXXXXX` - Phone number being used
- `SMS sent successfully: [message-id]` - Success
- `Vonage error: [error-text]` - Failure with details

---

## Troubleshooting

### SMS Not Sending

1. **Check Console Logs**: Open browser developer tools → Console
2. **Verify Credentials**: Ensure API Key and Secret are correct
3. **Check Account Balance**: Vonage requires credit for SMS
4. **Phone Format**: Ensure phone number is valid Greek mobile

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Invalid credentials | Wrong API Key/Secret | Check Vonage dashboard |
| Insufficient funds | No credit in account | Add credit to Vonage |
| Invalid phone | Wrong phone format | Check phone number |
| Blocked destination | Carrier issues | Contact Vonage support |

### Alphanumeric Sender ID Issues

Some countries require pre-registration of alphanumeric sender IDs. If "MondiHair" doesn't work:
1. Check Vonage documentation for Greece requirements
2. Consider purchasing a virtual phone number as sender
3. Contact Vonage support for assistance

---

## Alternative SMS Providers

If you need to switch providers in the future:

### Twilio
- **API**: `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`
- **Auth**: Basic auth with Account SID:Auth Token
- **Pricing**: ~€0.06 per SMS in Greece

### AWS SNS
- **API**: AWS SDK
- **Auth**: AWS credentials
- **Pricing**: ~€0.02-0.06 per SMS

---

## Security Notes

1. **Credentials in Frontend**: The current implementation has credentials in frontend code. For production, consider:
   - Using Firebase Cloud Functions
   - Setting up a backend proxy
   - Using environment variables

2. **Rate Limiting**: Consider adding rate limiting to prevent SMS abuse

3. **GDPR Compliance**: Ensure customers consent to receiving SMS notifications

---

## Files Overview

| File | Purpose |
|------|---------|
| `js/booking-system.js` | SMS sending logic and configuration |
| `admin.html` | 2-hour reminder scheduler |
| `booking.html` | Customer booking form (collects phone) |

---

## Quick Reference

### Update Vonage Credentials
Edit `js/booking-system.js`:
```javascript
const VONAGE_CONFIG = {
  apiKey: 'NEW_API_KEY',
  apiSecret: 'NEW_API_SECRET',
  alphaSender: 'MondiHair',
  businessPhone: '+306974628335'
};
```

### Change Business Phone
Update `VONAGE_CONFIG.businessPhone` in the same file.

### Disable SMS
Comment out the `sendBookingConfirmation` call in `createBooking()` method.
