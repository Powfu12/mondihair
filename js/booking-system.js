// Booking System Logic

// Brevo Email Configuration
const BREVO_CONFIG = {
  apiKey: '2tC0rXq7SDGFPsAm',
  senderEmail: 'booking@mondihair.com',
  senderName: 'Mondi Hairstyle',
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

      // Send confirmation email (don't fail booking if email fails)
      const emailResult = await this.sendBookingConfirmation({
        ...booking,
        barberName: booking.barberName
      });

      if (emailResult.success) {
        console.log('Confirmation email sent successfully');
      } else {
        console.warn('Failed to send confirmation email:', emailResult.error);
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
    let query = db.collection('bookings');
    if (barberId !== 'all') {
      query = query.where('barberId', '==', barberId);
    }
    return query.limit(300).onSnapshot(snapshot => {
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

  // Send email via Brevo API
  async sendEmail(to, subject, htmlContent) {
    try {
      if (!to) {
        throw new Error('No email address provided');
      }

      console.log('Sending email to:', to);

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_CONFIG.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: BREVO_CONFIG.senderName,
            email: BREVO_CONFIG.senderEmail
          },
          to: [{ email: to }],
          subject: subject,
          htmlContent: htmlContent
        })
      });

      const responseText = await response.text();
      console.log('Brevo response:', response.status, responseText);

      if (response.ok) {
        const data = JSON.parse(responseText);
        console.log('Email sent successfully:', data.messageId);
        return { success: true, messageId: data.messageId };
      } else {
        console.error('Brevo error:', responseText);
        return { success: false, error: responseText };
      }
    } catch (error) {
      console.error('Error sending email:', error);
      return { success: false, error: error.message };
    }
  }

  // Send booking confirmation email
  async sendBookingConfirmation(booking) {
    if (!booking.customerEmail) {
      console.warn('No email address for booking, skipping confirmation');
      return { success: false, error: 'No email address' };
    }

    const date = new Date(booking.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('el-GR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const subject = `Επιβεβαίωση Ραντεβού - Mondi Hairstyle`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a2e; color: #ffffff; border-radius: 12px; overflow: hidden;">
        <div style="background: #C3E321; padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: #1a1a2e; font-size: 22px;">Mondi Hairstyle</h1>
        </div>
        <div style="padding: 25px;">
          <h2 style="color: #C3E321; margin-top: 0;">Επιβεβαίωση Ραντεβού</h2>
          <p>Γεια σας <strong>${booking.customerName}</strong>!</p>
          <p>Το ραντεβού σας επιβεβαιώθηκε:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
            <tr><td style="padding: 8px 0; color: #aaa;">Ημερομηνία</td><td style="padding: 8px 0; font-weight: bold;">${dateStr}</td></tr>
            <tr><td style="padding: 8px 0; color: #aaa;">Ωρα</td><td style="padding: 8px 0; font-weight: bold;">${booking.timeSlot}</td></tr>
            <tr><td style="padding: 8px 0; color: #aaa;">Κομμωτής</td><td style="padding: 8px 0; font-weight: bold;">${booking.barberName}</td></tr>
            <tr><td style="padding: 8px 0; color: #aaa;">Υπηρεσία</td><td style="padding: 8px 0; font-weight: bold;">${booking.service}</td></tr>
          </table>
          <p style="color: #aaa; font-size: 13px;">Για ακύρωση καλέστε: ${BREVO_CONFIG.businessPhone}</p>
        </div>
        <div style="background: #111; padding: 15px; text-align: center; color: #666; font-size: 12px;">
          Mondi Hairstyle - Zakynthos
        </div>
      </div>`;

    return await this.sendEmail(booking.customerEmail, subject, htmlContent);
  }

  // Send 2-hour reminder email
  async send2HourReminder(booking) {
    if (!booking.customerEmail) {
      console.warn('No email address for booking, skipping reminder');
      return { success: false, error: 'No email address' };
    }

    const date = new Date(booking.date + 'T00:00:00');
    const dateStr = date.toLocaleDateString('el-GR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    const subject = `Υπενθύμιση Ραντεβού σε 2 ώρες - Mondi Hairstyle`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a2e; color: #ffffff; border-radius: 12px; overflow: hidden;">
        <div style="background: #C3E321; padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: #1a1a2e; font-size: 22px;">Mondi Hairstyle</h1>
        </div>
        <div style="padding: 25px;">
          <h2 style="color: #C3E321; margin-top: 0;">Υπενθύμιση Ραντεβού</h2>
          <p>Γεια σας <strong>${booking.customerName}</strong>!</p>
          <p>Έχετε ραντεβού σε <strong>2 ώρες</strong>:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
            <tr><td style="padding: 8px 0; color: #aaa;">Ημερομηνία</td><td style="padding: 8px 0; font-weight: bold;">${dateStr}</td></tr>
            <tr><td style="padding: 8px 0; color: #aaa;">Ωρα</td><td style="padding: 8px 0; font-weight: bold;">${booking.timeSlot}</td></tr>
            <tr><td style="padding: 8px 0; color: #aaa;">Κομμωτής</td><td style="padding: 8px 0; font-weight: bold;">${booking.barberName}</td></tr>
          </table>
          <p style="color: #C3E321;">Παρακαλούμε να είστε εκεί 5 λεπτά νωρίτερα.</p>
          <p style="color: #aaa; font-size: 13px;">Για ακύρωση καλέστε: ${BREVO_CONFIG.businessPhone}</p>
        </div>
        <div style="background: #111; padding: 15px; text-align: center; color: #666; font-size: 12px;">
          Mondi Hairstyle - Zakynthos
        </div>
      </div>`;

    return await this.sendEmail(booking.customerEmail, subject, htmlContent);
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
