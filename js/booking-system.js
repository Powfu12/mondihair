// Booking System Logic

// Bird SMS Configuration
const BIRD_CONFIG = {
  accessKey: 't22Ajcb993Kp0XPH2gxiGpqGU7VML74xAsPW',
  workspaceId: '6d56cc80-c572-44fa-9d7f-92de60064047',
  channelId: 'a8fe839d-0a11-5f96-b027-d2ffdc0fe8cc',
  businessPhone: '+306974628335'
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

      // Check if a slot has already passed (for today only)
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      // Filter out booked slots and check against time ranges
      const availableSlots = timeSlots.filter(slot => {
        const inWorkingHours = isSlotInWorkingHours(slot, daySchedule.ranges);
        const isBooked = bookedSlots.includes(slot);
        const inClosureRange = isSlotInClosureRange(slot);

        // If today, filter out slots that have already passed
        if (isToday) {
          const [slotH, slotM] = slot.split(':').map(Number);
          const slotMinutes = slotH * 60 + slotM;
          if (slotMinutes <= currentMinutes) return false;
        }

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

  // Create a new booking
  async createBooking(bookingData) {
    try {
      // Check if this specific slot is already booked (direct check, no recalculation)
      const existingBooking = await db.collection('bookings')
        .where('barberId', '==', bookingData.barberId)
        .where('date', '==', bookingData.date)
        .where('timeSlot', '==', bookingData.timeSlot)
        .where('status', 'in', ['pending', 'confirmed'])
        .get();

      if (!existingBooking.empty) {
        console.error('Slot already booked:', bookingData.timeSlot);
        throw new Error('This time slot is no longer available');
      }

      // Create booking document (automatically confirmed)
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

      const docRef = await db.collection('bookings').add(booking);

      console.log('Booking created successfully:', docRef.id);

      // Send confirmation SMS (don't fail booking if SMS fails)
      const smsResult = await this.sendBookingConfirmation({
        ...booking,
        barberName: booking.barberName
      });

      if (smsResult.success) {
        console.log('Confirmation SMS sent successfully');
      } else {
        console.warn('Failed to send confirmation SMS:', smsResult.error);
      }

      return {
        success: true,
        bookingId: docRef.id,
        message: 'Booking created successfully!'
      };
    } catch (error) {
      console.error('Error creating booking:', error);
      return {
        success: false,
        message: error.message || 'Failed to create booking'
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

  // Delete/cancel booking
  async cancelBooking(bookingId) {
    try {
      await db.collection('bookings').doc(bookingId).update({
        status: 'cancelled',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      console.error('Error cancelling booking:', error);
      return { success: false, message: error.message };
    }
  }

  // Listen for real-time updates
  listenToBookings(barberId, callback) {
    return db.collection('bookings')
      .where('barberId', '==', barberId)
      .limit(100)
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

  // Send SMS via Bird API
  async sendSMS(to, message) {
    try {
      const formattedPhone = this.formatGreekPhone(to);
      if (!formattedPhone) {
        throw new Error('Invalid phone number format');
      }

      console.log('Sending SMS to:', formattedPhone);

      const url = `https://api.bird.com/workspaces/${BIRD_CONFIG.workspaceId}/channels/${BIRD_CONFIG.channelId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `AccessKey ${BIRD_CONFIG.accessKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receiver: {
            contacts: [
              { identifierValue: formattedPhone }
            ]
          },
          body: {
            type: 'text',
            text: {
              text: message
            }
          }
        })
      });

      if (response.status === 202 || response.ok) {
        const data = await response.json();
        console.log('SMS sent successfully:', data.id);
        return { success: true, sid: data.id };
      } else {
        const data = await response.json();
        console.error('Bird error:', data);
        return { success: false, error: data.title || data.detail || 'Unknown error' };
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

Για ακύρωση: ${BIRD_CONFIG.businessPhone}

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

Για ακύρωση: ${BIRD_CONFIG.businessPhone}

Mondi Hairstyle`;

    return await this.sendSMS(booking.customerPhone, message);
  }

  // Get bookings needing reminder (~2 hours before appointment)
  async getBookingsNeedingReminder() {
    try {
      const now = new Date();

      // Format as YYYY-MM-DD
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      console.log('Checking reminders at:', todayStr, `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);

      const snapshot = await db.collection('bookings')
        .where('date', '==', todayStr)
        .where('status', 'in', ['confirmed', 'pending'])
        .get();

      const bookingsNeedingReminder = [];

      snapshot.docs.forEach(doc => {
        const booking = { id: doc.id, ...doc.data() };

        // Skip if reminder already sent
        if (booking.reminderSent) return;

        const [bookingHour, bookingMinute] = booking.timeSlot.split(':').map(Number);
        const bookingMinutes = bookingHour * 60 + bookingMinute;

        // Minutes until the appointment
        const minutesUntilAppointment = bookingMinutes - currentMinutes;

        // Send reminder when appointment is 90-150 minutes away (1.5h to 2.5h)
        // This gives a wide 1-hour window so the scheduler (every 5 min) won't miss it
        // The reminderSent flag prevents duplicate sends
        if (minutesUntilAppointment >= 90 && minutesUntilAppointment <= 150) {
          console.log(`Booking ${booking.id} at ${booking.timeSlot} needs reminder (${minutesUntilAppointment} min away)`);
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
