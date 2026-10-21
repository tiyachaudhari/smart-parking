const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
require('dotenv').config();

const { initDB } = require('./db');
const { startExpireLocksJob } = require('./jobs/expireLocks');

// Routes
const authRoutes = require('./routes/auth');
const slotsRoutes = require('./routes/slots');
const bookingRoutes = require('./routes/booking');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// API Routes
app.use('/api', authRoutes);
app.use('/api', slotsRoutes);
app.use('/api', bookingRoutes);

// Database initialization & Server start
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start background job for lock expiry
    startExpireLocksJob();
  });
}).catch(err => {
  console.error('Failed to start server:', err);
});
