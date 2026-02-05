// Booking System Logic

// Twilio Configuration
// IMPORTANT: Replace these with your actual Twilio credentials
const TWILIO_CONFIG = {
  accountSid: 'YOUR_TWILIO_ACCOUNT_SID',     // Replace with your Account SID from Twilio Console
  authToken: 'YOUR_TWILIO_AUTH_TOKEN',        // Replace with your Auth Token from Twilio Console
  alphaSender: 'MondiHair',                   // Your alphanumeric sender name
  businessPhone: '+306974628335'              // Your business phone for customers to call
};

class BookingSystem {
  constructor() {
    this.selectedBarber = null;
    this.selectedService = null;
    this.selectedDate = null;
    this.selectedTime = null;
  }

  // Get available time slots for a specific barber and date
  async getAvailableTimeSlots(barberId, date) {
    try {
      // CRITICAL FIX: Format date in local timezone, not UTC
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      // Fix timezone issue: use getDay() instead of toLocaleDateString
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = dayNames[date.getDay()];

      console.log('Getting slots for:', barberId, dateStr, dayName);

      // Check if barber works on this day
      const barber = BARBERS[barberId];
      if (!barber) {
        console.error('Barber not found:', barberId);
        return [];
      }

      const daySchedule = barber.workingHours[dayName];
      if (!daySchedule) {
        console.error('No schedule for day:', dayName);
        return [];
      }

      if (daySchedule.closed) {
        console.log('Barber is closed on', dayName);
        return [];
      }

      // Check for custom closures (full day or time range)
      const closuresSnapshot = await db.collection('customClosures')
        .where('barberId', '==', barberId)
        .where('date', '==', dateStr)
        .get();

      const customClosures = closuresSnapshot.docs.map(doc => doc.data());
      console.log('Custom closures for this date:', customClosures);

      // If there's a full day closure, return empty
      const hasFullDayClosure = customClosures.some(c => c.type === 'fullDay');
      if (hasFullDayClosure) {
        console.log('Barber has full day closure on', dateStr);
        return [];
      }

      // Get all bookings for this barber on this date
      const bookingsSnapshot = await db.collection('bookings')
        .where('barberId', '==', barberId)
        .where('date', '==', dateStr)
        .where('status', 'in', ['pending', 'confirmed'])
        .get();

      const bookedSlots = bookingsSnapshot.docs.map(doc => doc.data().timeSlot);
      console.log('Booked slots:', bookedSlots);

      // Check if slot is within ANY of the time ranges for this day
      const isSlotInWorkingHours = (slot, ranges) => {
        const slotTime = slot.split(':');
        const slotHour = parseInt(slotTime[0]);
        const slotMinute = parseInt(slotTime[1]);

        return ranges.some(range => {
          const startTime = range.start.split(':');
          const endTime = range.end.split(':');
          const startHour = parseInt(startTime[0]);
          const startMinute = parseInt(startTime[1]);
          const endHour = parseInt(endTime[0]);
          const endMinute = parseInt(endTime[1]);

          // Convert to minutes for easier comparison
          const slotMinutes = slotHour * 60 + slotMinute;
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = endHour * 60 + endMinute;

          return slotMinutes >= startMinutes && slotMinutes < endMinutes;
        });
      };

      // Get barber-specific time slots (20 min for Mondi, 30 min for others)
      const timeSlots = getTimeSlotsForBarber(barberId);
      console.log('Total time slots for barber:', timeSlots.length);
      console.log('Barber slot interval:', barber.slotInterval);
      console.log('Day schedule ranges:', JSON.stringify(daySchedule.ranges));

      // Check if slot is within a custom closure time range
      const isSlotInClosureRange = (slot) => {
        const timeRangeClosures = customClosures.filter(c => c.type === 'timeRange');
        return timeRangeClosures.some(closure => {
          const slotTime = slot.split(':');
          const slotHour = parseInt(slotTime[0]);
          const slotMinute = parseInt(slotTime[1]);
          const slotMinutes = slotHour * 60 + slotMinute;

          const startTime = closure.startTime.split(':');
          const endTime = closure.endTime.split(':');
          const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
          const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);

          return slotMinutes >= startMinutes && slotMinutes < endMinutes;
        });
      };

      // Filter out booked slots and check against time ranges
      const availableSlots = timeSlots.filter(slot => {
        const inWorkingHours = isSlotInWorkingHours(slot, daySchedule.ranges);
        const isBooked = bookedSlots.includes(slot);
        const inClosureRange = isSlotInClosureRange(slot);
        return inWorkingHours && !isBooked && !inClosureRange;
      });

      console.log('Available slots:', availableSlots);
      console.log('Total available:', availableSlots.length);
      return availableSlots;
    } catch (error) {
      console.error('Error getting available slots:', error);
      // Re-throw permissions errors so calendar can detect them
      if (error.code === 'permission-denied' ||
          (error.message && error.message.toLowerCase().includes('permission'))) {
        throw error;
      }
      return [];
    }
  }

  // Create a new booking using ATOMIC Firestore transaction
  // This prevents race conditions and double bookings at the database level
  async createBooking(bookingData) {
    try {
      console.log('=== ATOMIC BOOKING CREATION ===');
      console.log('Barber ID:', bookingData.barberId);
      console.log('Date:', bookingData.date);
      console.log('Time slot:', bookingData.timeSlot);

      // Step 1: Check if slot is available using existing bookings (backwards compatibility)
      // This handles old bookings that don't have slot locks
      const existingBooking = await db.collection('bookings')
        .where('barberId', '==', bookingData.barberId)
        .where('date', '==', bookingData.date)
        .where('timeSlot', '==', bookingData.timeSlot)
        .where('status', 'in', ['pending', 'confirmed'])
        .get();

      if (!existingBooking.empty) {
        console.log('ABORT: Slot already has an existing booking');
        return {
          success: false,
          message: 'Αυτή η ώρα δεν είναι πλέον διαθέσιμη. Παρακαλώ επιλέξτε άλλη ώρα.'
        };
      }

      // Step 2: Create unique slot lock ID for atomic operation
      const slotLockId = `${bookingData.barberId}_${bookingData.date}_${bookingData.timeSlot.replace(':', '')}`;
      const slotLockRef = db.collection('slotLocks').doc(slotLockId);
      const bookingRef = db.collection('bookings').doc(); // Auto-generate booking ID

      console.log('Slot lock ID:', slotLockId);
      console.log('Starting atomic transaction...');

      // Step 3: Use Firestore transaction for atomic slot lock + booking creation
      // This guarantees that only ONE booking can be created for a given slot
      await db.runTransaction(async (transaction) => {
        // Check if slot is already locked
        const slotLockDoc = await transaction.get(slotLockRef);

        if (slotLockDoc.exists) {
          console.log('TRANSACTION ABORT: Slot already locked by another booking');
          throw new Error('Αυτή η ώρα δεν είναι πλέον διαθέσιμη. Παρακαλώ επιλέξτε άλλη ώρα.');
        }

        console.log('Slot is free, creating atomic booking...');

        // Create the booking document
        const booking = {
          barberId: bookingData.barberId,
          barberName: BARBERS[bookingData.barberId].name,
          customerName: bookingData.customerName,
          customerPhone: bookingData.customerPhone,
          customerEmail: bookingData.customerEmail || '',
          service: bookingData.service,
          date: bookingData.date,
          timeSlot: bookingData.timeSlot,
          status: 'confirmed',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          confirmedAt: firebase.firestore.FieldValue.serverTimestamp(),
          notes: bookingData.notes || ''
        };

        // Atomically create BOTH the slot lock AND the booking
        transaction.set(slotLockRef, {
          bookingId: bookingRef.id,
          barberId: bookingData.barberId,
          date: bookingData.date,
          timeSlot: bookingData.timeSlot,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        transaction.set(bookingRef, booking);

        console.log('Transaction prepared successfully');
      });

      console.log('TRANSACTION COMMITTED: Booking created atomically');
      console.log('Booking ID:', bookingRef.id);

      // Send confirmation SMS (outside transaction - SMS failure shouldn't rollback booking)
      const booking = {
        customerName: bookingData.customerName,
        customerPhone: bookingData.customerPhone,
        date: bookingData.date,
        timeSlot: bookingData.timeSlot,
        service: bookingData.service,
        barberName: BARBERS[bookingData.barberId].name
      };

      console.log('Sending confirmation SMS...');
      const smsResult = await this.sendBookingConfirmation(booking);

      if (smsResult.success) {
        console.log('Confirmation SMS sent successfully');
      } else {
        console.warn('Failed to send confirmation SMS:', smsResult.error);
      }

      return {
        success: true,
        bookingId: bookingRef.id,
        message: 'Booking created successfully!'
      };
    } catch (error) {
      console.error('Error creating booking:', error);

      // Provide user-friendly error message
      let userMessage = error.message;
      if (error.message && error.message.includes('Αυτή η ώρα')) {
        userMessage = error.message; // Already Greek
      } else if (error.code === 'permission-denied') {
        userMessage = 'Δεν έχετε άδεια για αυτή την ενέργεια.';
      } else {
        userMessage = 'Αποτυχία δημιουργίας κράτησης. Παρακαλώ δοκιμάστε ξανά.';
      }

      return {
        success: false,
        message: userMessage
      };
    }
  }

  // Get bookings for a specific barber
  async getBarberBookings(barberId, startDate, endDate) {
    try {
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const snapshot = await db.collection('bookings')
        .where('barberId', '==', barberId)
        .where('date', '>=', startDateStr)
        .where('date', '<=', endDateStr)
        .get();

      const bookings = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort in JavaScript
      bookings.sort((a, b) => {
        if (a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        return a.timeSlot.localeCompare(b.timeSlot);
      });

      return bookings;
    } catch (error) {
      console.error('Error getting bookings:', error);
      return [];
    }
  }

  // Update booking status
  async updateBookingStatus(bookingId, newStatus) {
    try {
      await db.collection('bookings').doc(bookingId).update({
        status: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating booking:', error);
      return { success: false, message: error.message };
    }
  }

  // Delete/cancel booking and release the slot lock
  async cancelBooking(bookingId) {
    try {
      // First, get the booking to find the slot lock
      const bookingDoc = await db.collection('bookings').doc(bookingId).get();

      if (!bookingDoc.exists) {
        throw new Error('Booking not found');
      }

      const bookingData = bookingDoc.data();

      // Create the slot lock ID to delete it
      const slotLockId = `${bookingData.barberId}_${bookingData.date}_${bookingData.timeSlot.replace(':', '')}`;

      console.log('Cancelling booking and releasing slot lock:', slotLockId);

      // Use a batch to atomically update booking AND delete slot lock
      const batch = db.batch();

      // Update booking status to cancelled
      batch.update(db.collection('bookings').doc(bookingId), {
        status: 'cancelled',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Delete the slot lock to free up the time slot
      batch.delete(db.collection('slotLocks').doc(slotLockId));

      await batch.commit();

      console.log('Booking cancelled and slot released successfully');
      return { success: true };
    } catch (error) {
      console.error('Error cancelling booking:', error);
      return { success: false, message: error.message };
    }
  }

  // Listen for real-time updates
  listenToBookings(barberId, callback) {
    // Get date range: 30 days ago to 90 days in future
    const now = new Date();
    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - 30);
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 90);

    const pastDateStr = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-${String(pastDate.getDate()).padStart(2, '0')}`;
    const futureDateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

    return db.collection('bookings')
      .where('barberId', '==', barberId)
      .where('date', '>=', pastDateStr)
      .where('date', '<=', futureDateStr)
      .onSnapshot(snapshot => {
        const bookings = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        // Sort in JavaScript instead of Firestore (avoids needing index)
        bookings.sort((a, b) => {
          // Sort by date (newest first), then by time slot (latest first)
          if (a.date !== b.date) {
            return b.date.localeCompare(a.date);
          }
          return b.timeSlot.localeCompare(a.timeSlot);
        });

        callback(bookings);
      }, error => {
        console.error('Error listening to bookings:', error);
      });
  }

  // Format Greek phone number to E.164 format (+30XXXXXXXXXX)
  formatGreekPhone(phone) {
    if (!phone) return null;

    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Handle different formats
    if (cleaned.startsWith('00300')) {
      cleaned = cleaned.substring(4); // Remove 0030
    } else if (cleaned.startsWith('0030')) {
      cleaned = cleaned.substring(4); // Remove 0030
    } else if (cleaned.startsWith('300')) {
      cleaned = cleaned.substring(2); // Remove 30
    } else if (cleaned.startsWith('30')) {
      cleaned = cleaned.substring(2); // Remove 30
    } else if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1); // Remove leading 0
    }

    // Should be 10 digits now (Greek number without country code)
    if (cleaned.length === 10) {
      return '+30' + cleaned;
    }

    // If it's already 12 digits (30 + 10 digits), add +
    if (cleaned.length === 12 && cleaned.startsWith('30')) {
      return '+' + cleaned;
    }

    console.error('Invalid Greek phone number format:', phone);
    return null;
  }

  // Send SMS via Twilio
  async sendSMS(to, message) {
    try {
      const formattedPhone = this.formatGreekPhone(to);
      if (!formattedPhone) {
        throw new Error('Invalid phone number format');
      }

      console.log('Sending SMS to:', formattedPhone);

      const auth = btoa(`${TWILIO_CONFIG.accountSid}:${TWILIO_CONFIG.authToken}`);

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_CONFIG.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            From: TWILIO_CONFIG.alphaSender,
            To: formattedPhone,
            Body: message
          })
        }
      );

      const data = await response.json();

      if (response.ok) {
        console.log('SMS sent successfully:', data.sid);
        return { success: true, sid: data.sid };
      } else {
        console.error('Twilio error:', data);
        return { success: false, error: data.message };
      }
    } catch (error) {
      console.error('Error sending SMS:', error);
      return { success: false, error: error.message };
    }
  }

  // Send booking confirmation SMS
  async sendBookingConfirmation(booking) {
    const date = new Date(booking.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('el-GR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const message = `✅ Επιβεβαίωση Ραντεβού

Γεια σας ${booking.customerName}!

Το ραντεβού σας επιβεβαιώθηκε:

📅 ${dateStr}
🕐 ${booking.timeSlot}
💇 Κομμωτής: ${booking.barberName}
✂️ Υπηρεσία: ${booking.service}

Για ακύρωση: ${TWILIO_CONFIG.businessPhone}

Mondi Hairstyle`;

    return await this.sendSMS(booking.customerPhone, message);
  }

  // Send 2-hour reminder SMS
  async send2HourReminder(booking) {
    const date = new Date(booking.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('el-GR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    const message = `🔔 Υπενθύμιση Ραντεβού

Έχετε ραντεβού σε 2 ώρες:

📅 ${dateStr}
🕐 ${booking.timeSlot} με ${booking.barberName}

⏰ Παρακαλούμε να είστε εκεί 5 λεπτά νωρίτερα.

Για ακύρωση: ${TWILIO_CONFIG.businessPhone}

Mondi Hairstyle`;

    return await this.sendSMS(booking.customerPhone, message);
  }

  // Get bookings needing reminder (2 hours before)
  async getBookingsNeedingReminder() {
    try {
      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      // Format as YYYY-MM-DD
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // Get target hour for comparison (2 hours from now)
      const targetHour = String(twoHoursLater.getHours()).padStart(2, '0');
      const targetMinute = String(twoHoursLater.getMinutes()).padStart(2, '0');
      const targetTime = `${targetHour}:${targetMinute}`;

      console.log('Looking for bookings at:', todayStr, targetTime);

      const snapshot = await db.collection('bookings')
        .where('date', '==', todayStr)
        .where('status', 'in', ['confirmed', 'pending'])
        .get();

      const bookingsNeedingReminder = [];

      snapshot.docs.forEach(doc => {
        const booking = { id: doc.id, ...doc.data() };

        // Check if booking time is approximately 2 hours from now (within 5 min window)
        const bookingTime = booking.timeSlot;
        const [bookingHour, bookingMinute] = bookingTime.split(':').map(Number);
        const [targetH, targetM] = [parseInt(targetHour), parseInt(targetMinute)];

        // Within 5 minute window
        const timeDiff = Math.abs((bookingHour * 60 + bookingMinute) - (targetH * 60 + targetM));

        if (timeDiff <= 5 && !booking.reminderSent) {
          bookingsNeedingReminder.push(booking);
        }
      });

      return bookingsNeedingReminder;
    } catch (error) {
      console.error('Error getting bookings for reminder:', error);
      return [];
    }
  }

  // Mark reminder as sent
  async markReminderSent(bookingId) {
    try {
      await db.collection('bookings').doc(bookingId).update({
        reminderSent: true,
        reminderSentAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error marking reminder sent:', error);
    }
  }
}

// Initialize booking system
const bookingSystem = new BookingSystem();
