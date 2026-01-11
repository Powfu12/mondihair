// Booking System Logic

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
      const dateStr = date.toISOString().split('T')[0];
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

      // Filter out booked slots and check against time ranges
      const availableSlots = timeSlots.filter(slot => {
        return isSlotInWorkingHours(slot, daySchedule.ranges) && !bookedSlots.includes(slot);
      });

      console.log('Available slots:', availableSlots);
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
      // Validate that the time slot is still available
      // Fix: Parse date correctly to avoid timezone issues
      const [year, month, day] = bookingData.date.split('-').map(Number);
      const bookingDate = new Date(year, month - 1, day);

      console.log('Validating booking for:', bookingData.barberId, bookingData.date, bookingData.timeSlot);

      const availableSlots = await this.getAvailableTimeSlots(
        bookingData.barberId,
        bookingDate
      );

      console.log('Available slots for validation:', availableSlots);
      console.log('Requested time slot:', bookingData.timeSlot);

      if (!availableSlots.includes(bookingData.timeSlot)) {
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
}

// Initialize booking system
const bookingSystem = new BookingSystem();
