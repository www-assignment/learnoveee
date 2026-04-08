/**
 * routes/auth.js
 * Learnove — All authentication endpoints (Supabase version).
 *
 * Endpoints:
 *   POST /register
 *   POST /login
 *   GET  /me
 *   POST /logout
 *   POST /forgotpassword
 *   POST /update-password
 *   POST /confirm-email
 *   POST /resend-verification
 *   POST /resend-verification-by-email
 *
 * Security model:
 *  • Supabase Auth handles JWT issuance, email verification links, and
 *    password reset links automatically via magic URLs.
 *  • We mirror user data in a `profiles` table (Postgres via Supabase) for
 *    extended fields: role, account_type, interests, lock state, etc.
 *  • Passwords are also bcrypt-hashed in our profiles table for server-side
 *    validation (lock-out logic, custom checks).
 *  • Account lockout after 5 failed login attempts (15-min lock).
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const { supabaseAdmin } = require('../supabaseAdmin');
const { sendEmail }     = require('../utils/emailService');
const {
  protect,
  authLimiter,
  strictLimiter
} = require('../middleware/auth');

const router = express.Router();

// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS       = 12;
const MAX_LOGIN_ATTEMPTS  = 5;
const LOCK_DURATION_MS    = 15 * 60 * 1000; // 15 min

// ─── Helpers ──────────────────────────────────────────────────────────────────
function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }
  return null;
}

function sanitiseProfile(profile) {
  if (!profile) return null;
  const {
    password_hash,
    login_attempts,
    lock_until,
    ...safe
  } = profile;
  return safe;
}

function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

// ─── Audit log (fire-and-forget) ──────────────────────────────────────────────
async function audit(userId, action, meta = {}) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id:    userId,
      action,
      ip:         meta.ip || null,
      meta:       JSON.stringify(meta),
      created_at: new Date().toISOString()
    });
  } catch { /* best-effort, never throw */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /register
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register',
  authLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2–50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9])/)
      .withMessage('Password must include uppercase, lowercase, number, and special character'),
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match');
      return true;
    }),
    body('accountType').optional().isIn(['individual', 'student']),
    body('educationLevel').optional().isIn(['secondary', 'university', 'graduate', 'other', '']),
    body('graduationYear').optional({ nullable: true }).isInt({ min: 1990, max: 2040 }),
    body('interests').optional().isArray({ max: 15 }),
    body('avatar').optional().custom(val => {
      if (val && !val.startsWith('data:image/')) throw new Error('Invalid avatar format');
      if (val && val.length > 2 * 1024 * 1024 * 1.4) throw new Error('Avatar exceeds 2 MB');
      return true;
    })
  ],
  async (req, res) => {
    const err = handleValidationErrors(req, res);
    if (err) return;

    const {
      name, email, password,
      accountType    = 'individual',
      educationLevel = '',
      institution    = '',
      major          = '',
      graduationYear = null,
      interests      = [],
      avatar         = null
    } = req.body;

    try {
      // ── Check if email already exists in our profiles table ──
      const { data: existing } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'An account with this email already exists.'
        });
      }

      // ── Create Supabase Auth user ──
      // emailRedirectTo = where Supabase sends the user after clicking the
      // verification link in the email it sends automatically.
      const { data: authData, error: authError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: false,     // we want Supabase to send verification email
          user_metadata: { name }
        });

      if (authError) {
        if (authError.message?.toLowerCase().includes('already registered') ||
            authError.message?.toLowerCase().includes('already exists')) {
          return res.status(409).json({
            success: false,
            error: 'An account with this email already exists.'
          });
        }
        throw authError;
      }

      const uid = authData.user.id;

      // ── Hash password for our own server-side checks ──
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // ── Build profile row ──
      const profileRow = {
        id:               uid,
        name:             name.trim(),
        email:            email.toLowerCase(),
        password_hash:    passwordHash,
        role:             'user',
        account_type:     accountType,
        is_email_verified: false,
        is_active:        true,
        login_attempts:   0,
        lock_until:       null,
        last_login:       null,
        avatar:           avatar || null,
        education_level:  educationLevel || null,
        institution:      institution || null,
        major:            major || null,
        graduation_year:  graduationYear ? Number(graduationYear) : null,
        interests:        Array.isArray(interests) ? interests.slice(0, 15) : [],
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString()
      };

      const { error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert(profileRow);

      if (insertError) {
        // Clean up the auth user if profile insert failed
        await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
        throw insertError;
      }

      // ── Generate Supabase verification email ──
      // Supabase will send its own verification email automatically when
      // email_confirm is false. But we also send our branded email.
      // Generate a sign-in link we can include in our own email:
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: 'signup',
        email,
        options: {
          redirectTo: `${frontendUrl()}/pages/verify-email.html`
        }
      });

      const verifyUrl = linkData?.properties?.action_link ||
        `${frontendUrl()}/pages/verify-email.html`;

      // Send our branded verification email
      await sendEmail({
        email,
        subject: '✅ Verify Your Learnove Email',
        template: 'emailVerification',
        data: { name: name.trim(), verificationUrl: verifyUrl }
      });

      audit(uid, 'REGISTER', { ip: req.ip, email });

      return res.status(201).json({
        success: true,
        message: 'Account created! Please verify your email.',
        user: sanitiseProfile(profileRow)
      });

    } catch (err) {
      console.error('Register error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Registration failed. Please try again.'
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /login
// Server-side validation (bcrypt + lock check).
// The client then calls supabase.auth.signInWithPassword() to get the JWT.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    const err = handleValidationErrors(req, res);
    if (err) return;

    const { email, password } = req.body;

    try {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (profileError || !profile) {
        // Constant-time fake compare to prevent timing attacks
        await bcrypt.compare(password, '$2b$12$invalidhashpadding00000000000000000000000000000000000');
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
      }

      if (!profile.is_active) {
        return res.status(403).json({
          success: false,
          error: 'Account deactivated. Contact support.'
        });
      }

      if (profile.lock_until && new Date(profile.lock_until) > new Date()) {
        const minutes = Math.ceil((new Date(profile.lock_until) - Date.now()) / 60000);
        return res.status(423).json({
          success: false,
          error: `Account locked. Try again in ${minutes} minute(s).`
        });
      }

      const match = await bcrypt.compare(password, profile.password_hash);
      if (!match) {
        const attempts = (profile.login_attempts || 0) + 1;
        const update   = {
          login_attempts: attempts,
          updated_at: new Date().toISOString()
        };
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          update.lock_until = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
          update.login_attempts = 0;
          audit(profile.id, 'ACCOUNT_LOCKED', { ip: req.ip });
        }
        await supabaseAdmin.from('profiles').update(update).eq('id', profile.id);

        const remaining = MAX_LOGIN_ATTEMPTS - attempts;
        const msg = attempts >= MAX_LOGIN_ATTEMPTS
          ? 'Too many failed attempts. Account locked for 15 minutes.'
          : `Invalid email or password.${remaining > 0 ? ` ${remaining} attempt(s) remaining.` : ''}`;
        return res.status(401).json({ success: false, error: msg });
      }

      if (!profile.is_email_verified) {
        return res.status(403).json({
          success: false,
          error: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email before signing in.'
        });
      }

      // Reset lock + update last login
      await supabaseAdmin
        .from('profiles')
        .update({
          login_attempts: 0,
          lock_until:     null,
          last_login:     new Date().toISOString(),
          updated_at:     new Date().toISOString()
        })
        .eq('id', profile.id);

      audit(profile.id, 'LOGIN', { ip: req.ip });

      return res.status(200).json({
        success: true,
        message: 'Credentials verified. Proceed with Supabase sign-in.',
        user: sanitiseProfile(profile)
      });

    } catch (err) {
      console.error('Login error:', err.message);
      return res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /me  (requires valid Supabase JWT)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.json({ success: true, data: sanitiseProfile(profile) });
  } catch (err) {
    console.error('GET /me error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not retrieve user.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /logout
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    // Sign out the user from all sessions using Supabase admin
    await supabaseAdmin.auth.admin.signOut(req.accessToken, 'global');
    audit(req.user.id, 'LOGOUT', { ip: req.ip });
    return res.json({ success: true, message: 'Signed out successfully.' });
  } catch (err) {
    // Even if this fails, the client-side signOut is what actually matters
    console.error('Logout error:', err.message);
    return res.json({ success: true, message: 'Signed out.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /forgotpassword
// Supabase sends the reset email automatically; we send our branded one too.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/forgotpassword',
  strictLimiter,
  [ body('email').isEmail().normalizeEmail() ],
  async (req, res) => {
    const err = handleValidationErrors(req, res);
    if (err) return;

    // Always return success to prevent user enumeration
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, name, email, is_active')
        .eq('email', req.body.email.toLowerCase())
        .maybeSingle();

      if (profile && profile.is_active) {
        // Generate Supabase password reset link
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email: profile.email,
          options: {
            redirectTo: `${frontendUrl()}/pages/reset-password.html`
          }
        });

        const resetUrl = linkData?.properties?.action_link ||
          `${frontendUrl()}/pages/reset-password.html`;

        await sendEmail({
          email: profile.email,
          subject: '🔐 Learnove Password Reset Request',
          template: 'passwordReset',
          data: { name: profile.name, resetUrl }
        });

        audit(profile.id, 'FORGOT_PASSWORD', { ip: req.ip });
      }
    } catch (err) {
      console.error('Forgot password error:', err.message);
      /* swallow — always return success */
    }

    return res.json({
      success: true,
      message: 'If that email is registered, a reset link has been sent.'
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /update-password
// Called by the reset-password page after supabase.auth.updateUser() succeeds.
// Updates bcrypt hash in our profiles table + logs the event.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/update-password',
  protect,
  [
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9])/)
      .withMessage('Password must meet all requirements')
  ],
  async (req, res) => {
    const err = handleValidationErrors(req, res);
    if (err) return;

    try {
      const newHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);

      await supabaseAdmin
        .from('profiles')
        .update({
          password_hash:  newHash,
          login_attempts: 0,
          lock_until:     null,
          updated_at:     new Date().toISOString()
        })
        .eq('id', req.user.id);

      audit(req.user.id, 'PASSWORD_UPDATED', { ip: req.ip });

      return res.json({
        success: true,
        message: 'Password updated successfully.'
      });
    } catch (err) {
      console.error('Update password error:', err.message);
      return res.status(500).json({ success: false, error: 'Could not update password.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /confirm-email
// Called by verify-email.html after Supabase fires the SIGNED_IN event
// following email confirmation. We sync is_email_verified in our profiles table.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/confirm-email', protect, async (req, res) => {
  try {
    // Check Supabase auth user to confirm email is actually verified
    const { data: { user: authUser } } =
      await supabaseAdmin.auth.admin.getUserById(req.user.id);

    if (!authUser?.email_confirmed_at) {
      return res.status(400).json({
        success: false,
        error: 'Email not yet confirmed in Supabase Auth.'
      });
    }

    await supabaseAdmin
      .from('profiles')
      .update({
        is_email_verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id);

    // Send welcome email (best-effort)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, email')
      .eq('id', req.user.id)
      .single();

    if (profile) {
      sendEmail({
        email: profile.email,
        subject: '🎉 Welcome to Learnove — You\'re Verified!',
        template: 'welcome',
        data: { name: profile.name }
      }).catch(() => {});
    }

    audit(req.user.id, 'EMAIL_VERIFIED', { ip: req.ip });

    return res.json({ success: true, message: 'Email verified successfully.' });
  } catch (err) {
    console.error('Confirm email error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not confirm email.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /resend-verification  (authenticated — signed in but unverified)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/resend-verification',
  protect,
  strictLimiter,
  async (req, res) => {
    if (req.user.is_email_verified) {
      return res.json({ success: true, message: 'Your email is already verified.' });
    }

    try {
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: 'signup',
        email: req.user.email,
        options: {
          redirectTo: `${frontendUrl()}/pages/verify-email.html`
        }
      });

      const verifyUrl = linkData?.properties?.action_link ||
        `${frontendUrl()}/pages/verify-email.html`;

      await sendEmail({
        email: req.user.email,
        subject: '✅ Verify Your Learnove Email',
        template: 'emailVerification',
        data: { name: req.user.name, verificationUrl: verifyUrl }
      });

      audit(req.user.id, 'RESEND_VERIFICATION', { ip: req.ip });
      return res.json({ success: true, message: 'Verification email sent!' });

    } catch (err) {
      console.error('Resend verification error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Could not send verification email.'
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /resend-verification-by-email  (unauthenticated — login-wall flow)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/resend-verification-by-email',
  strictLimiter,
  [ body('email').isEmail().normalizeEmail() ],
  async (req, res) => {
    const err = handleValidationErrors(req, res);
    if (err) return;

    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, name, email, is_email_verified, is_active')
        .eq('email', req.body.email.toLowerCase())
        .maybeSingle();

      if (profile && !profile.is_email_verified && profile.is_active) {
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: 'signup',
          email: profile.email,
          options: {
            redirectTo: `${frontendUrl()}/pages/verify-email.html`
          }
        });

        const verifyUrl = linkData?.properties?.action_link ||
          `${frontendUrl()}/pages/verify-email.html`;

        await sendEmail({
          email: profile.email,
          subject: '✅ Verify Your Learnove Email',
          template: 'emailVerification',
          data: { name: profile.name, verificationUrl: verifyUrl }
        });

        audit(profile.id, 'RESEND_VERIFICATION_BY_EMAIL', { ip: req.ip });
      }
    } catch { /* swallow */ }

    return res.json({
      success: true,
      message: 'If that email is registered and unverified, a link has been sent.'
    });
  }
);

module.exports = router;