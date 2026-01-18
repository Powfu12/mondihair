// Firebase Configuration
// INSTRUCTIONS: Replace the values below with your actual Firebase project credentials
// Get these from: Firebase Console → Project Settings → Your Apps → Web App

const firebaseConfig = {
  apiKey: "AIzaSyBH_OsOcoOmpU2e2X_2oJC1S7aaW_BOIh8",
  authDomain: "mondi-2aeae.firebaseapp.com",
  projectId: "mondi-2aeae",
  storageBucket: "mondi-2aeae.firebasestorage.app",
  messagingSenderId: "991484333412",
  appId: "1:991484333412:web:5d8147f3b8f18f34fdbe71",
  measurementId: "G-5R79ZF6XN8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Barbers configuration
// Working hours now support multiple time ranges per day (for breaks)
// Mondi uses 20-minute intervals, others use 30-minute intervals
const BARBERS = {
  mondi: {
    id: 'mondi',
    name: 'Mondi',
    email: 'mondi@mondihair.com',
    slotInterval: 20, // 20-minute intervals
    services: ['Haircut', 'Haircut + Beard', 'Beard Trim & Shape', 'Haircut + Beard + Wash + Styling'],
    workingHours: {
      monday: {
        ranges: [
          { start: '09:00', end: '14:20' },
          { start: '16:40', end: '21:20' }
        ]
      },
      tuesday: {
        ranges: [
          { start: '09:00', end: '14:20' },
          { start: '16:40', end: '21:20' }
        ]
      },
      wednesday: {
        ranges: [
          { start: '09:00', end: '14:20' },
          { start: '16:40', end: '21:20' }
        ]
      },
      thursday: {
        ranges: [
          { start: '09:00', end: '14:20' },
          { start: '16:40', end: '21:20' }
        ]
      },
      friday: {
        ranges: [
          { start: '09:00', end: '14:20' },
          { start: '16:40', end: '21:20' }
        ]
      },
      saturday: {
        ranges: [
          { start: '09:00', end: '14:20' },
          { start: '16:40', end: '21:20' }
        ]
      },
      sunday: { closed: true }
    }
  },
  ervin: {
    id: 'ervin',
    name: 'Ervin',
    email: 'ervin@mondihair.com',
    slotInterval: 30, // 30-minute intervals
    services: ['Haircut', 'Haircut + Beard', 'Beard Trim & Shape', 'Haircut + Beard + Wash + Styling'],
    workingHours: {
      monday: {
        ranges: [
          { start: '09:00', end: '14:30' },
          { start: '16:40', end: '21:20' }
        ]
      },
      tuesday: {
        ranges: [
          { start: '09:00', end: '14:30' },
          { start: '16:40', end: '21:20' }
        ]
      },
      wednesday: {
        ranges: [
          { start: '09:00', end: '14:30' },
          { start: '16:40', end: '21:20' }
        ]
      },
      thursday: {
        ranges: [
          { start: '09:00', end: '14:30' },
          { start: '16:40', end: '21:20' }
        ]
      },
      friday: {
        ranges: [
          { start: '09:00', end: '14:30' },
          { start: '16:40', end: '21:20' }
        ]
      },
      saturday: {
        ranges: [
          { start: '09:00', end: '14:30' },
          { start: '16:40', end: '21:20' }
        ]
      },
      sunday: { closed: true }
    }
  },
  marios: {
    id: 'marios',
    name: 'Marios',
    email: 'marios@mondihair.com',
    slotInterval: 30, // 30-minute intervals
    services: ['Haircut', 'Haircut + Beard', 'Beard Trim & Shape', 'Haircut + Beard + Wash + Styling'],
    workingHours: {
      monday: {
        ranges: [
          { start: '09:00', end: '14:00' },
          { start: '16:40', end: '21:00' }
        ]
      },
      tuesday: {
        ranges: [
          { start: '09:00', end: '14:00' },
          { start: '16:40', end: '21:00' }
        ]
      },
      wednesday: {
        ranges: [
          { start: '09:00', end: '14:00' },
          { start: '16:40', end: '21:00' }
        ]
      },
      thursday: {
        ranges: [
          { start: '09:00', end: '14:00' },
          { start: '16:40', end: '21:00' }
        ]
      },
      friday: {
        ranges: [
          { start: '09:00', end: '14:00' },
          { start: '16:40', end: '21:00' }
        ]
      },
      saturday: {
        ranges: [
          { start: '09:00', end: '14:00' },
          { start: '16:40', end: '21:00' }
        ]
      },
      sunday: { closed: true }
    }
  }
};

// Time slots for 30-minute intervals (Ervin, Marios)
const TIME_SLOTS_30 = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'
];

// Time slots for 20-minute intervals (Mondi)
const TIME_SLOTS_20 = [
  '09:00', '09:20', '10:00', '10:20', '10:40',
  '11:00', '11:20', '11:40', '12:00', '12:20', '12:40',
  '13:00', '13:20', '13:40', '14:00', '14:20', '14:40',
  '15:00', '15:20', '15:40', '16:00', '16:20', '16:40',
  '17:00', '17:20', '17:40', '18:00', '18:20', '18:40',
  '19:00', '19:20', '19:40', '20:00', '20:20', '20:40', '21:00', '21:20'
];

// Helper function to get time slots for a specific barber
function getTimeSlotsForBarber(barberId) {
  const barber = BARBERS[barberId];
  return barber.slotInterval === 20 ? TIME_SLOTS_20 : TIME_SLOTS_30;
}

// Service prices (in euros)
const SERVICES = {
  'Haircut': { price: 13, duration: 30, description: 'Traditional barbering techniques with modern precision.' },
  'Haircut + Beard': { price: 15, duration: 45, description: 'Complete haircut and beard grooming service.' },
  'Beard Trim & Shape': { price: 7, duration: 20, description: 'Professional beard grooming with class.' },
  'Haircut + Beard + Wash + Styling': { price: 20, duration: 60, description: 'Complete grooming package. Our most popular service.' }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { db, auth, BARBERS, TIME_SLOTS_20, TIME_SLOTS_30, getTimeSlotsForBarber, SERVICES };
}
