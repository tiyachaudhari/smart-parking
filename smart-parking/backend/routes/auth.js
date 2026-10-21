const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getPool } = require('../db');

// Register User
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const pool = getPool();
    const hash = await bcrypt.hash(password, 10);
    
    // Check if email already exists
    const [existing] = await pool.query('SELECT user_id FROM USER WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists.' });
    }

    const [result] = await pool.query(
      'INSERT INTO USER (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
      [name, email, phone, hash]
    );

    res.json({ success: true, data: { user_id: result.insertId }, message: 'Registration successful.' });
  } catch (error) {
    console.error('Error in /register:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required.' });
    }

    const pool = getPool();
    const [users] = await pool.query('SELECT * FROM USER WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Set session
    req.session.user = {
      user_id: user.user_id,
      name: user.name,
      email: user.email
    };

    res.json({ success: true, message: 'Login successful.' });
  } catch (error) {
    console.error('Error in /login:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Get Current User (Session)
router.get('/me', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const pool = getPool();
    const [vehicles] = await pool.query('SELECT * FROM VEHICLE WHERE user_id = ?', [req.session.user.user_id]);
    
    res.json({ 
      success: true, 
      data: {
        user: req.session.user,
        vehicles: vehicles
      }
    });
  } catch (error) {
    console.error('Error in /me:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
