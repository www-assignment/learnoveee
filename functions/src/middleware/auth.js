/**
 * middleware/auth.js
 * Learnove — Express middleware using Supabase for token verification.
 *
 * Strategy:
 *  • Clients send a Supabase access_token in the Authorization: Bearer header.
 *  • We verify it using the Supabase admin client (getUser), which validates
 *    the JWT against Supabase's signing keys.
 *  • We then load the user's extended profile from our `profiles` table
 *    for role / lock / active checks.
 */

'use strict';

const { supabaseAdmin } = require('../supabaseAdmin');
const rateLimit         = require('express-rate-limit');

// ─── Verify Supabase JWT and load profile ─────────────────────────────────────
exports.protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify the JWT and get the Supabase auth user
    const { data: { user: authUser }, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session. Please sign in again.'
      });
    }

    // Load extended profile from our profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ success: false, error: 'Account not found.' });
    }

    if (!profile.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Contact support.'
      });
    }

    // Check account lock
    if (profile.lock_until && new Date(profile.lock_until) > new Date()) {
      const minutes = Math.ceil((new Date(profile.lock_until) - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        error: `Account temporarily locked. Try again in ${minutes} minute(s).`
      });
    }

    // Attach both auth user and profile to request
    req.user       = profile;
    req.authUser   = authUser;
    req.accessToken = token;
    next();

  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid session. Please sign in.'
    });
  }
};

// ─── Optional auth — attaches user if token valid, never blocks ───────────────
exports.optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  const token = authHeader.split(' ')[1];
  try {
    const { data: { user: authUser }, error } =
      await supabaseAdmin.auth.getUser(token);
    if (!error && authUser) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();
      if (profile) {
        req.user = profile;
        req.authUser = authUser;
      }
    }
  } catch { /* ignore */ }
  next();
};

// ─── Role-based access ────────────────────────────────────────────────────────
exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'You do not have permission to access this resource.'
    });
  }
  next();
};

// ─── Require verified email ───────────────────────────────────────────────────
exports.requireEmailVerified = (req, res, next) => {
  if (!req.user?.is_email_verified) {
    return res.status(403).json({
      success: false,
      error: 'Please verify your email address before accessing this feature.'
    });
  }
  next();
};

// ─── Auth-specific rate limiter (tighter than global) ────────────────────────
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'Too many failed attempts. Please try again in 15 minutes.'
  },
  keyGenerator: (req) => req.ip + ':' + (req.body?.email || '')
});

// ─── Strict limiter for sensitive endpoints ───────────────────────────────────
exports.strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again in 1 hour.'
  },
  keyGenerator: (req) => req.ip + ':' + (req.body?.email || '')
});