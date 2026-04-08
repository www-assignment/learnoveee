/**
 * src/index.js
 * Learnove API — Express entry point (Render production ready).
 *
 * Express serves BOTH the frontend static files AND the backend API.
 * This means one single Render service = one single URL for everything.
 *
 * URL structure on Render:
 *   https://your-app.onrender.com/          → index.html (homepage)
 *   https://your-app.onrender.com/pages/*   → HTML pages (dashboard, verify, reset)
 *   https://your-app.onrender.com/api/*     → Express API routes
 */

'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── Path to frontend folder ──────────────────────────────────────────────────
// On Render, the repo root is the working directory.
// __dirname = functions/src → ../../frontend = frontend/
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

// ─── Trust Render's proxy (important for rate limiting & IP detection) ────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // Frontend uses inline scripts + CDN imports
  crossOriginEmbedderPolicy: false
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Since frontend and backend are on the same domain, CORS is relaxed.
// We still keep it explicit for security.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no origin header) and listed origins
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

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Global rate limiter ──────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' }
}));

// ─── Serve frontend static files ──────────────────────────────────────────────
// Must come BEFORE API routes so static files are served directly.
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

// ─── Fallback: serve frontend for any non-API route ──────────────────────────
// Handles direct navigation to /pages/dashboard.html etc.
app.get(/^(?!\/api).*/, (req, res) => {
  const filePath = path.join(FRONTEND_DIR, req.path);
  res.sendFile(filePath, (err) => {
    if (err) res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
});

// ─── API 404 handler ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route ' + req.method + ' ' + req.path + ' not found.'
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 Learnove running on port ' + PORT);
  console.log('   Serving frontend : ' + FRONTEND_DIR);
  console.log('   Environment      : ' + (process.env.NODE_ENV || 'development'));
  console.log('   Health check     : http://localhost:' + PORT + '/api/health\n');
});

module.exports = app;