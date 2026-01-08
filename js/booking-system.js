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
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

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

      // Filter out booked slots
      const availableSlots = TIME_SLOTS.filter(slot => {
        const slotTime = slot.split(':');
        const startTime = daySchedule.start.split(':');
        const endTime = daySchedule.end.split(':');

        // Check if slot is within working hours
        const slotHour = parseInt(slotTime[0]);
        const slotMinute = parseInt(slotTime[1]);
        const startHour = parseInt(startTime[0]);
        const endHour = parseInt(endTime[0]);

        // More precise time checking
        const isWithinHours = (
          (slotHour > startHour || (slotHour === startHour && slotMinute >= 0)) &&
          slotHour < endHour
        );

        return isWithinHours && !bookedSlots.includes(slot);
      });

      console.log('Available slots:', availableSlots);
      return availableSlots;
    } catch (error) {
      console.error('Error getting available slots:', error);
      return [];
    }
  }

  // Create a new booking
  async createBooking(bookingData) {
    try {
      // Validate that the time slot is still available
      const availableSlots = await this.getAvailableTimeSlots(
        bookingData.barberId,
        new Date(bookingData.date)
      );

      if (!availableSlots.includes(bookingData.timeSlot)) {
        throw new Error('This time slot is no longer available');
      }

      // Create booking document
      const booking = {
        barberId: bookingData.barberId,
        barberName: BARBERS[bookingData.barberId].name,
        customerName: bookingData.customerName,
        customerPhone: bookingData.customerPhone,
        customerEmail: bookingData.customerEmail || '',
        service: bookingData.service,
        date: bookingData.date,
        timeSlot: bookingData.timeSlot,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
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
        .orderBy('date', 'asc')
        .orderBy('timeSlot', 'asc')
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
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
      .orderBy('date', 'desc')
      .orderBy('timeSlot', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        const bookings = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        callback(bookings);
      }, error => {
        console.error('Error listening to bookings:', error);
      });
  }
}

// Initialize booking system
const bookingSystem = new BookingSystem();
