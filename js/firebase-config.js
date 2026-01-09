// Firebase Configuration
// INSTRUCTIONS: Replace the values below with your actual Firebase project credentials
// Get these from: Firebase Console → Project Settings → Your Apps → Web App

const firebaseConfig = {
  apiKey: "AIzaSyACwhlu2BLBgS_OVDbifCHcWuoA6VTRM0E",
  authDomain: "mondi-hairstyle.firebaseapp.com",
  projectId: "mondi-hairstyle",
  storageBucket: "mondi-hairstyle.firebasestorage.app",
  messagingSenderId: "1022691382356",
  appId: "1:1022691382356:web:fd5480391f79a8685049c1"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Barbers configuration
const BARBERS = {
  mondi: {
    id: 'mondi',
    name: 'Mondi',
    email: 'mondi@mondihair.com',
    services: ['Haircut', 'Beard Trim', 'Haircut + Beard', 'Hair Color', 'Kids Haircut'],
    workingHours: {
      monday: { start: '09:00', end: '20:00' },
      tuesday: { start: '09:00', end: '20:00' },
      wednesday: { start: '09:00', end: '20:00' },
      thursday: { start: '09:00', end: '20:00' },
      friday: { start: '09:00', end: '20:00' },
      saturday: { start: '09:00', end: '18:00' },
      sunday: { closed: true }
    }
  },
  ervin: {
    id: 'ervin',
    name: 'Ervin',
    email: 'ervin@mondihair.com',
    services: ['Haircut', 'Beard Trim', 'Haircut + Beard', 'Hair Color', 'Kids Haircut'],
    workingHours: {
      monday: { start: '09:00', end: '20:00' },
      tuesday: { start: '09:00', end: '20:00' },
      wednesday: { start: '09:00', end: '20:00' },
      thursday: { start: '09:00', end: '20:00' },
      friday: { start: '09:00', end: '20:00' },
      saturday: { start: '09:00', end: '18:00' },
      sunday: { closed: true }
    }
  },
  marios: {
    id: 'marios',
    name: 'Marios',
    email: 'marios@mondihair.com',
    services: ['Haircut', 'Beard Trim', 'Haircut + Beard', 'Hair Color', 'Kids Haircut'],
    workingHours: {
      monday: { start: '09:00', end: '20:00' },
      tuesday: { start: '09:00', end: '20:00' },
      wednesday: { start: '09:00', end: '20:00' },
      thursday: { start: '09:00', end: '20:00' },
      friday: { start: '09:00', end: '20:00' },
      saturday: { start: '09:00', end: '18:00' },
      sunday: { closed: true }
    }
  }
};

// Time slots (30-minute intervals)
const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00'
];

// Service prices
const SERVICES = {
  'Haircut': { price: 15, duration: 30 },
  'Beard Trim': { price: 10, duration: 20 },
  'Haircut + Beard': { price: 20, duration: 45 },
  'Hair Color': { price: 40, duration: 60 },
  'Kids Haircut': { price: 12, duration: 25 }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { db, auth, BARBERS, TIME_SLOTS, SERVICES };
}
