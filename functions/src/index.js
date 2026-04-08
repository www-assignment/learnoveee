/**
 * src/index.js
 * Learnove API — Express entry point.
 *
 * KEY FIX: Express now serves the frontend/static files too.
 * This means Supabase email links (e.g. /pages/verify-email.html)
 * work regardless of whether they land on port 4000 or 5500.
 */

'use strict';

// Load .env in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
}

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── Path to the frontend folder ──────────────────────────────────────────────
// __dirname = LEARNOVE/functions/src
// ../../frontend = LEARNOVE/frontend
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

// ─── Security headers ─────────────────────────────────────────────────────────
// Relax CSP so the frontend inline scripts and CDN imports work
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    'http://localhost:3000', 'http://127.0.0.1:3000',
    'http://localhost:4000', 'http://127.0.0.1:4000',
    'http://localhost:5500', 'http://127.0.0.1:5500'
  );
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error('CORS: origin ' + origin + ' not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── HTTP request logging (dev only) ─────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ─── Global rate limiter ──────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' }
}));

// ─── Serve frontend static files ──────────────────────────────────────────────
// CRITICAL FIX: email links land on port 4000 and Express serves the HTML page.
app.use(express.static(FRONTEND_DIR, {
  extensions: ['html'],
  index: 'index.html'
}));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Learnove API is running.',
    timestamp: new Date().toISOString()
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ─── Fallback: serve frontend pages for any non-API route ────────────────────
app.get(/^(?!\/api).*/, (req, res) => {
  const filePath = path.join(FRONTEND_DIR, req.path);
  res.sendFile(filePath, (err) => {
    if (err) res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
});

// ─── API 404 handler ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route ' + req.method + ' ' + req.path + ' not found.' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 Learnove API running on http://localhost:' + PORT);
  console.log('   Serving frontend from : ' + FRONTEND_DIR);
  console.log('   Environment           : ' + (process.env.NODE_ENV || 'development'));
  console.log('   Health check          : http://localhost:' + PORT + '/api/health\n');
});

module.exports = app;