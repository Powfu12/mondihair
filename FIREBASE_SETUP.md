# Firebase Booking System Setup Guide

This guide will help you set up the Firebase booking system for Mondi Hairstyle barbershop.

## 📋 Overview

The booking system includes:
- **Customer Booking Page** (`booking.html`) - Allows customers to book appointments
- **Admin Dashboard** (`admin.html`) - Separate dashboards for each barber (Mondi, Ervin, Marios)
- **Real-time Updates** - Instant booking notifications
- **Booking Management** - Accept, reject, complete, or cancel bookings

---

## 🚀 Step 1: Create Firebase Project

1. **Go to Firebase Console**
   - Visit: https://console.firebase.google.com/
   - Sign in with your Google account

2. **Create New Project**
   - Click **"Add Project"** or **"Create a project"**
   - Enter project name: `mondi-barbershop` (or your preferred name)
   - Click **"Continue"**

3. **Google Analytics (Optional)**
   - You can disable Google Analytics for now
   - Click **"Create Project"**
   - Wait for project creation (30-60 seconds)
   - Click **"Continue"** when ready

---

## 🔥 Step 2: Enable Firestore Database

1. **Navigate to Firestore**
   - In the left sidebar, click **"Build"** → **"Firestore Database"**
   - Click **"Create database"**

2. **Choose Security Rules**
   - Select **"Start in test mode"** (for development)
   - ⚠️ **Important:** Test mode allows unrestricted access. We'll secure it later.
   - Click **"Next"**

3. **Select Location**
   - Choose the Cloud Firestore location closest to your users
   - For Europe: Choose `europe-west1` or `europe-west2`
   - Click **"Enable"**

---

## 🔐 Step 3: Enable Authentication

1. **Navigate to Authentication**
   - In the left sidebar, click **"Build"** → **"Authentication"**
   - Click **"Get started"**

2. **Enable Email/Password**
   - Click on the **"Sign-in method"** tab
   - Click **"Email/Password"**
   - Toggle **"Enable"** to ON
   - Click **"Save"**

---

## 🔑 Step 4: Get Firebase Configuration

1. **Register Web App**
   - In Project Overview, click the **web icon** `</>`
   - Enter app nickname: `Mondi Barbershop Web`
   - Don't check "Also set up Firebase Hosting"
   - Click **"Register app"**

2. **Copy Configuration**
   - You'll see a code snippet with `firebaseConfig`
   - It looks like this:

   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSyC...",
     authDomain: "mondi-barbershop.firebaseapp.com",
     projectId: "mondi-barbershop",
     storageBucket: "mondi-barbershop.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```

3. **Update Your Code**
   - Open `js/firebase-config.js`
   - Replace the placeholder values with your actual config:

   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY_HERE",           // Replace this
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",  // Replace this
     projectId: "YOUR_PROJECT_ID",          // Replace this
     storageBucket: "YOUR_PROJECT_ID.appspot.com",   // Replace this
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",  // Replace this
     appId: "YOUR_APP_ID"                   // Replace this
   };
   ```

---

## 🔒 Step 5: Configure Security Rules

Once you're ready to deploy, update Firestore security rules:

1. **Go to Firestore Database**
   - Click **"Rules"** tab

2. **Update Rules**
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // Bookings: Anyone can create, only authenticated users can read/update
       match /bookings/{booking} {
         allow create: if true;  // Customers can book
         allow read, update, delete: if request.auth != null;  // Only admins can manage
       }

       // Barbers: Only authenticated users can read
       match /barbers/{barber} {
         allow read: if request.auth != null;
       }

       // Users: Only authenticated users can access
       match /users/{user} {
         allow read, write: if request.auth != null && request.auth.uid == user;
       }
     }
   }
   ```

3. **Publish Rules**
   - Click **"Publish"**

---

## 👥 Step 6: Create Admin Accounts

Each barber needs their own login credentials:

1. **Access Admin Dashboard**
   - Open `admin.html` in your browser
   - You'll see the login screen

2. **Create Accounts for Each Barber**

   **For Mondi:**
   - Select: `Mondi`
   - Email: `mondi@mondihair.com` (or any email)
   - Password: Create a secure password
   - Click **"Login"** (will create account on first use)

   **For Ervin:**
   - Select: `Ervin`
   - Email: `ervin@mondihair.com`
   - Password: Create a secure password
   - Click **"Login"**

   **For Marios:**
   - Select: `Marios`
   - Email: `marios@mondihair.com`
   - Password: Create a secure password
   - Click **"Login"**

---

## 📱 Step 7: Test the System

### Test Customer Booking:

1. **Open Booking Page**
   - Navigate to `booking.html`
   - Or click "Book Now" on the main website

2. **Create Test Booking**
   - Select a barber
   - Choose a service
   - Pick a date and time
   - Enter customer details
   - Submit booking

3. **Verify in Admin Dashboard**
   - Login to `admin.html` with the barber's credentials
   - You should see the booking appear instantly

### Test Booking Management:

1. **Confirm Booking**
   - Click "Confirm" button
   - Status changes to "Confirmed"

2. **Complete Booking**
   - Click "Mark Complete"
   - Status changes to "Completed"

3. **Cancel Booking**
   - Click "Cancel"
   - Booking is cancelled

---

## 🎨 Customization Options

### Update Working Hours

Edit `js/firebase-config.js`:

```javascript
workingHours: {
  monday: { start: '09:00', end: '20:00' },
  tuesday: { start: '09:00', end: '20:00' },
  // ... customize for each barber
}
```

### Update Services & Prices

Edit `js/firebase-config.js`:

```javascript
const SERVICES = {
  'Haircut': { price: 15, duration: 30 },
  'Beard Trim': { price: 10, duration: 20 },
  // Add or modify services
};
```

### Update Time Slots

Edit `js/firebase-config.js`:

```javascript
const TIME_SLOTS = [
  '09:00', '09:30', '10:00', // Add or remove slots
];
```

---

## 🔍 Viewing Bookings in Firebase

1. **Go to Firestore Database**
   - Click **"Data"** tab
   - You'll see the `bookings` collection

2. **View Booking Details**
   - Click on any booking document
   - You can see all fields and values
   - You can manually edit or delete bookings here

---

## 🌐 Deployment

### Option 1: Firebase Hosting (Recommended)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in your project
firebase init

# Select:
# - Hosting
# - Use existing project (select your project)
# - Public directory: . (current directory)
# - Configure as single-page app: No
# - Set up automatic builds: No

# Deploy
firebase deploy
```

Your site will be live at: `https://your-project-id.web.app`

### Option 2: Any Web Host

Simply upload all files to your web host:
- `index.html`
- `booking.html`
- `admin.html`
- `js/` folder
- All other assets

---

## 📊 Database Structure

The system automatically creates these Firestore collections:

### `bookings` Collection
```javascript
{
  barberId: "mondi",
  barberName: "Mondi",
  customerName: "John Doe",
  customerPhone: "+357 99 123456",
  customerEmail: "john@example.com",
  service: "Haircut",
  date: "2026-01-15",
  timeSlot: "10:00",
  status: "pending",  // pending, confirmed, completed, rejected, cancelled
  createdAt: Timestamp,
  notes: "Please use clippers #2"
}
```

---

## 🆘 Troubleshooting

### "Permission denied" errors
- Check Firestore security rules
- Make sure you're in "test mode" during development

### Bookings not appearing
- Check browser console for errors
- Verify Firebase config in `js/firebase-config.js`
- Check Network tab to see if Firebase requests are successful

### Login not working
- Verify Email/Password authentication is enabled
- Check browser console for error messages

### Time slots not loading
- Check if date is selected
- Verify barber is selected
- Check browser console for errors

---

## 📞 Support

For issues or questions:
- Check Firebase Console → Firestore → Logs
- Check browser console (F12 → Console tab)
- Review Firebase documentation: https://firebase.google.com/docs

---

## ✅ Checklist

- [ ] Firebase project created
- [ ] Firestore database enabled
- [ ] Authentication enabled (Email/Password)
- [ ] Firebase config added to `js/firebase-config.js`
- [ ] Admin accounts created for all barbers
- [ ] Test booking created successfully
- [ ] Booking appears in admin dashboard
- [ ] Booking management tested (confirm/reject/complete)
- [ ] Security rules updated (before production)
- [ ] Website deployed

---

## 🎉 You're All Set!

Your booking system is now ready to use. Customers can book appointments through `booking.html`, and barbers can manage their schedules through `admin.html`.

**Important URLs:**
- **Customer Booking:** `https://yourwebsite.com/booking.html`
- **Admin Dashboard:** `https://yourwebsite.com/admin.html`
