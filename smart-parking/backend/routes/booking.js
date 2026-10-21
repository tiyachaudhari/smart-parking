const express = require('express');
const router = express.Router();
const { getPool } = require('../db');

const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// Initiate Booking (Lock Slot)
router.post('/book', requireAuth, async (req, res) => {
  try {
    const { vehicle_id, lot_id } = req.body;
    if (!vehicle_id || !lot_id) {
      return res.status(400).json({ success: false, message: 'vehicle_id and lot_id required.' });
    }

    const pool = getPool();

    // Check if slot is available
    const [slots] = await pool.query('SELECT slot_status FROM PARKING_LOT WHERE lot_id = ?', [lot_id]);
    if (slots.length === 0 || slots[0].slot_status !== 'Available') {
      return res.status(400).json({ success: false, message: 'Slot is not available.' });
    }

    // Call stored procedure to book
    // IN p_user_id INT, IN p_vehicle_id INT, IN p_lot_id INT, OUT p_booking_id INT
    // mysql2 doesn't map OUT params directly in standard queries easily. We can use a user variable
    await pool.query('CALL sp_book_slot(?, ?, ?, @p_booking_id)', [req.session.user.user_id, vehicle_id, lot_id]);
    const [result] = await pool.query('SELECT @p_booking_id AS booking_id');
    const booking_id = result[0].booking_id;

    // Get lock expiry time
    const [bookings] = await pool.query('SELECT lock_expires_at FROM BOOKING WHERE booking_id = ?', [booking_id]);
    
    res.json({ success: true, data: { booking_id, lock_expires_at: bookings[0].lock_expires_at } });

  } catch (error) {
    console.error('Error in /book:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Confirm Payment
router.post('/confirm-payment', requireAuth, async (req, res) => {
  try {
    const { booking_id, payment_method } = req.body;
    if (!booking_id || !payment_method) {
      return res.status(400).json({ success: false, message: 'booking_id and payment_method required.' });
    }

    const pool = getPool();

    // check if still locked and not expired
    const [bookings] = await pool.query('SELECT booking_status FROM BOOKING WHERE booking_id = ?', [booking_id]);
    if (bookings.length === 0 || bookings[0].booking_status !== 'Locked') {
      return res.status(400).json({ success: false, message: 'Booking is no longer active or lock expired.' });
    }

    await pool.query('CALL sp_confirm_payment(?, ?)', [booking_id, payment_method]);

    res.json({ success: true, message: 'Payment confirmed. Slot activated.' });
  } catch (error) {
    console.error('Error in /confirm-payment:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Exit Vehicle
router.post('/exit', requireAuth, async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) {
      return res.status(400).json({ success: false, message: 'booking_id required.' });
    }

    const pool = getPool();
    await pool.query('CALL sp_record_exit(?)', [booking_id]);

    // get summary
    const [receipt] = await pool.query(`
      SELECT p.amount, p.duration, p.entry_time, p.exit_time, 
             pl.zone, v.vehicle_type
      FROM PAYMENT p
      JOIN BOOKING b ON p.booking_id = b.booking_id
      JOIN PARKING_LOT pl ON b.lot_id = pl.lot_id
      JOIN VEHICLE v ON b.vehicle_id = v.vehicle_id
      WHERE p.booking_id = ?
    `, [booking_id]);

    res.json({ success: true, data: receipt[0], message: 'Vehicle exited successfully.' });
  } catch (error) {
    console.error('Error in /exit:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// My Bookings
router.get('/my-bookings', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    // Query the view instead - but view only shows Active/Locked. We need all for dashboard?
    // User requested "On dashboard, show user's active bookings. Each has an Exit & Pay button."
    // We'll limit it to Active for exit panel.
    const [rows] = await pool.query('SELECT * FROM vw_active_bookings WHERE user_id = ?', [req.session.user.user_id]);
    
    // We also might want recent bookings
    const [all] = await pool.query(`
      SELECT b.booking_id, b.booking_status, b.booking_time, p.amount, p.payment_status 
      FROM BOOKING b
      LEFT JOIN PAYMENT p ON b.booking_id = p.booking_id
      WHERE b.user_id = ?
      ORDER BY b.booking_time DESC LIMIT 5
    `, [req.session.user.user_id]);

    res.json({ success: true, data: { active: rows, history: all } });
  } catch (error) {
    console.error('Error in /my-bookings:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Cursor: Smart Auto-Recommend Slot
router.get('/recommend-slot', requireAuth, async (req, res) => {
  try {
    const { vehicle_type } = req.query;
    if(!vehicle_type) return res.status(400).json({ success: false, message: 'vehicle_type required.' });

    const pool = getPool();
    await pool.query('CALL sp_recommend_best_slot(?, @best_lot)', [vehicle_type]);
    const [result] = await pool.query('SELECT @best_lot AS lot_id');
    
    if(!result[0].lot_id) {
       return res.json({ success: false, message: 'No available slots for this vehicle type.' });
    }
    
    // fetch slot info to enrich response
    const [slotInfo] = await pool.query('SELECT * FROM vw_available_slots WHERE lot_id = ?', [result[0].lot_id]);
    res.json({ success: true, data: slotInfo[0] });
  } catch(error) {
    console.error('Error in /recommend-slot:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
