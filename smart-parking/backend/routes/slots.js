const express = require('express');
const router = express.Router();
const { getPool } = require('../db');

// Middleware to check auth
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// Add Vehicle
router.post('/vehicle', requireAuth, async (req, res) => {
  try {
    const { vehicle_number, vehicle_type } = req.body;
    if (!vehicle_number || !vehicle_type) {
      return res.status(400).json({ success: false, message: 'Vehicle number and type required.' });
    }

    const pool = getPool();
    // Insert vehicle
    const [result] = await pool.query(
      'INSERT INTO VEHICLE (vehicle_number, vehicle_type, user_id) VALUES (?, ?, ?)',
      [vehicle_number, vehicle_type, req.session.user.user_id]
    );

    res.json({ success: true, data: { vehicle_id: result.insertId }, message: 'Vehicle added.' });
  } catch (error) {
    console.error('Error in /vehicle:', error);
    // 1062 is duplicate entry for unique constraint
    if (error.errno === 1062) {
      return res.status(400).json({ success: false, message: 'Vehicle number already exists.' });
    }
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Get all slots with DB state
router.get('/slots', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const [slots] = await pool.query(`
      SELECT s.*, 
        CASE 
          WHEN s.slot_type = '2W' THEN 15.00
          WHEN s.slot_type = '4W' THEN 40.00
          WHEN s.slot_type = 'Heavy' THEN 80.00
        END + 
        CASE 
          WHEN s.zone = 'Gate' THEN 20.00
          WHEN s.zone = 'Middle' THEN 0.00
          WHEN s.zone = 'Far' THEN -10.00
        END AS min_charge_fallback
      FROM PARKING_LOT s
      ORDER BY s.floor_no, s.slot_no
    `);
    
    // Check if view fallback is needed, we optionally use the vw_available_slots but wait, 
    // the user wants the grid of ALL slots (including occupied), so querying the table is correct.

    res.json({ success: true, data: slots });
  } catch (error) {
    console.error('Error in /slots:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Floor occupancy report
router.get('/occupancy-report', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('CALL sp_floor_occupancy_report()');
    // CALL returns an array where the first element is the array of rows
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error in /occupancy-report:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Delete Vehicle
router.delete('/vehicle/:id', requireAuth, async (req, res) => {
  try {
    const vehicle_id = req.params.id;
    const pool = getPool();
    
    // Authorization check
    const [vehicles] = await pool.query('SELECT * FROM VEHICLE WHERE vehicle_id = ? AND user_id = ?', [vehicle_id, req.session.user.user_id]);
    if (vehicles.length === 0) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }
    
    // Check for active bookings to prevent state conflict
    const [activeBookings] = await pool.query('SELECT * FROM BOOKING WHERE vehicle_id = ? AND booking_status IN ("Active", "Locked")', [vehicle_id]);
    if (activeBookings.length > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete a vehicle with an active parking session.' });
    }

    try {
      await pool.query('DELETE FROM VEHICLE WHERE vehicle_id = ?', [vehicle_id]);
      res.json({ success: true, message: 'Vehicle removed.' });
    } catch (dbError) {
      // 1451 is MySQL foreign key constraint failure
      if (dbError.code === 'ER_ROW_IS_REFERENCED_2') {
         return res.status(400).json({ success: false, message: 'Cannot delete this vehicle because it has historical parking receipts attached.' });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error in DELETE /vehicle:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
