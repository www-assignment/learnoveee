/**
 * js/auth.js
 * Learnove Authentication Client (Supabase)
 *
 * Auth flow:
 *  1. User registers → POST /api/auth/register → verification email sent via Supabase
 *  2. User logs in   → POST /api/auth/login (server validates password/lock) →
 *                      if OK, call supabase.auth.signInWithPassword() →
 *                      Supabase returns session (access_token + refresh_token)
 *  3. Every API call → getAccessToken() sent as Bearer header
 *
 * Security decisions:
 *  • Sessions managed by Supabase SDK (sessionStorage — cleared on tab close)
 *  • No secrets in frontend — only the anon key (safe, locked by RLS)
 *  • User profile cached in sessionStorage
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL } from './supabase-config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── Initialise Supabase ──────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

let currentUser  = null;
let avatarBase64 = null;

// ─── DOMContentLoaded ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initModal();
  initForms();
  initAccountTypeTabs();
  initAvatarUpload();
  initPasswordStrength();

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      try {
        const profile = await apiFetch('/auth/me', { method: 'GET' });
        if (profile.success) {
          currentUser = profile.data;
          cacheUser(currentUser);
          updateUIForLoggedInUser(currentUser);
        }
      } catch { /* silent */ }
    } else {
      currentUser = null;
      clearCachedUser();
    }
  });

  const action = new URLSearchParams(window.location.search).get('action');
  if (action === 'login')  showModal('login');
  if (action === 'signup') showModal('signup');
});

// ─── Session cache ────────────────────────────────────────────────────────────
function cacheUser(user) {
  try { sessionStorage.setItem('lrn_user', JSON.stringify(user)); } catch {}
}
function clearCachedUser() {
  sessionStorage.removeItem('lrn_user');
}
function getCachedUser() {
  try { return JSON.parse(sessionStorage.getItem('lrn_user')); } catch { return null; }
}

// ─── Get current Supabase access token ───────────────────────────────────────
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

// ─── API Fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch(endpoint, options = {}, tokenOverride = null) {
  const token   = tokenOverride || await getAccessToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

  let data;
  try { data = await res.json(); }
  catch { data = { success: false, error: 'Server returned an invalid response.' }; }
  data._status = res.status;
  return data;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function initModal() {
  const pill = document.getElementById('signupPillBtn');
  if (pill) {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentUser) window.location.href = '/pages/dashboard.html';
      else showModal('signup');
    });
    pill.addEventListener('keydown', (e) => { if (e.key === 'Enter') pill.click(); });
  }

  document.querySelector('.close-modal')?.addEventListener('click', hideModal);
  document.getElementById('signupModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideModal(); });
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
  });
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', () => switchAuthTab('forgot'));
}

function showModal(tab = 'signup') {
  const modal = document.getElementById('signupModal');
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('show'));
  switchAuthTab(tab);
  document.body.style.overflow = 'hidden';
}

function hideModal() {
  const modal = document.getElementById('signupModal');
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.style.display = 'none'; }, 300);
  document.body.style.overflow = '';
  resetForms();
}

function switchAuthTab(tab) {
  // Only toggle visible auth-tab buttons for signup/login
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  // Map tab name → form ID
  const formMap = {
    signup: 'signupForm',
    login:  'loginForm',
    forgot: 'forgotPasswordForm'
  };

  // Hide all forms, then show the matching one
  Object.values(formMap).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    el.style.display = 'none';
  });

  const activeFormId = formMap[tab];
  if (activeFormId) {
    const activeForm = document.getElementById(activeFormId);
    if (activeForm) {
      activeForm.classList.add('active');
      activeForm.style.display = 'block';
    }
  }

  const titles = { signup: 'Join Learnove', login: 'Welcome Back', forgot: 'Reset Password' };
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.textContent = titles[tab] || 'Learnove';
}

// ─── Account type tabs ────────────────────────────────────────────────────────
function initAccountTypeTabs() {
  document.querySelectorAll('.account-type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const type = tab.dataset.type;
      document.querySelectorAll('.account-type-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.account-type-section').forEach(s => {
        s.classList.toggle('active', s.dataset.type === type);
      });
      const input = document.getElementById('accountTypeInput');
      if (input) input.value = type;
    });
  });
}

// ─── Avatar Upload ────────────────────────────────────────────────────────────
function initAvatarUpload() {
  const input       = document.getElementById('avatarInput');
  const preview     = document.getElementById('avatarPreview');
  const placeholder = document.getElementById('avatarPlaceholder');
  if (!input) return;

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please upload an image file', 'error'); return; }
    if (file.size > 2 * 1024 * 1024)    { showToast('Image must be under 2 MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      avatarBase64 = ev.target.result;
      if (preview)     { preview.src = avatarBase64; preview.style.display = 'block'; }
      if (placeholder)   placeholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('avatarUploadArea')?.addEventListener('click', () => input.click());
}

// ─── Password Strength ────────────────────────────────────────────────────────
function initPasswordStrength() {
  const input = document.getElementById('signupPassword');
  const bar   = document.getElementById('passwordStrengthBar');
  const label = document.getElementById('passwordStrengthLabel');
  if (!input || !bar) return;

  input.addEventListener('input', () => {
    const val = input.value;
    let score = 0;
    if (val.length >= 8)          score++;
    if (/[A-Z]/.test(val))        score++;
    if (/[a-z]/.test(val))        score++;
    if (/\d/.test(val))           score++;
    if (/[^a-zA-Z0-9]/.test(val)) score++;
    const levels = [
      { color: '#f44336', text: 'Very weak',   width: '20%' },
      { color: '#ff7043', text: 'Weak',        width: '40%' },
      { color: '#ffa726', text: 'Fair',        width: '60%' },
      { color: '#66bb6a', text: 'Strong',      width: '80%' },
      { color: '#43a047', text: 'Very strong', width: '100%' }
    ];
    const lvl = levels[Math.max(0, score - 1)] || levels[0];
    bar.style.width      = val ? lvl.width : '0%';
    bar.style.background = lvl.color;
    if (label) { label.textContent = val ? lvl.text : ''; label.style.color = lvl.color; }
  });
}

// ─── Forms ────────────────────────────────────────────────────────────────────
function initForms() {
  document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('forgotPasswordForm')?.addEventListener('submit', handleForgotPassword);

  document.getElementById('signupConfirmPassword')?.addEventListener('input', () => {
    const pw  = document.getElementById('signupPassword')?.value;
    const cpw = document.getElementById('signupConfirmPassword').value;
    const el  = document.getElementById('confirmPasswordError');
    if (el) el.textContent = cpw && pw !== cpw ? 'Passwords do not match' : '';
  });

  document.querySelectorAll('.interest-chip').forEach(chip => {
    chip.querySelector('input')?.addEventListener('change', function () {
      chip.classList.toggle('selected', this.checked);
    });
  });

  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'text' ? 'password' : 'text';
      btn.textContent = input.type === 'text' ? '🙈' : '👁';
    });
  });
}

function resetForms() {
  document.getElementById('signupForm')?.reset();
  document.getElementById('loginForm')?.reset();
  document.getElementById('forgotPasswordForm')?.reset();
  avatarBase64 = null;
  const preview     = document.getElementById('avatarPreview');
  const placeholder = document.getElementById('avatarPlaceholder');
  if (preview)     { preview.src = ''; preview.style.display = 'none'; }
  if (placeholder)   placeholder.style.display = 'flex';
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.interest-chip').forEach(c => c.classList.remove('selected'));
}

// ─── Handle Signup ────────────────────────────────────────────────────────────
async function handleSignup(e) {
  e.preventDefault();
  clearFieldErrors();

  const name            = document.getElementById('signupName').value.trim();
  const email           = document.getElementById('signupEmail').value.trim();
  const password        = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupConfirmPassword').value;
  const accountType     = document.getElementById('accountTypeInput')?.value || 'individual';
  const termsChecked    = document.getElementById('termsAgree')?.checked;

  let hasError = false;
  if (!name) { setFieldError('nameError', 'Full name is required'); hasError = true; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError('emailError', 'Valid email is required'); hasError = true;
  }
  if (password.length < 8) { setFieldError('passwordError', 'Password must be at least 8 characters'); hasError = true; }
  if (password !== confirmPassword) { setFieldError('confirmPasswordError', 'Passwords do not match'); hasError = true; }
  if (!termsChecked) { showToast('Please agree to the Terms & Privacy Policy', 'warning'); hasError = true; }
  if (hasError) return;

  const interests      = Array.from(document.querySelectorAll('#signupForm input[name="interests"]:checked')).map(c => c.value);
  const educationLevel = document.getElementById('educationLevel')?.value || '';
  const institution    = document.getElementById('institution')?.value?.trim() || '';
  const major          = document.getElementById('major')?.value?.trim() || '';
  const graduationYear = document.getElementById('graduationYear')?.value || null;

  setLoading('signupSubmit', true);
  try {
    const payload = {
      name, email, password, confirmPassword,
      accountType, interests, educationLevel,
      institution, major, graduationYear
    };
    if (avatarBase64) payload.avatar = avatarBase64;

    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });

    if (data.success) {
      hideModal();
      showVerificationNotice(email);
    } else {
      handleApiErrors(data);
    }
  } catch (err) {
    console.error('Signup error:', err);
    showToast('Connection error. Please check your internet and try again.', 'error');
  } finally {
    setLoading('signupSubmit', false);
  }
}

function showVerificationNotice(email) {
  const overlay = document.createElement('div');
  overlay.id = 'verifyOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(30,10,50,0.7);backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:40px 32px;max-width:460px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(80,20,120,0.3);">
      <div style="font-size:3rem;margin-bottom:16px;">📧</div>
      <h2 style="font-family:'Orbitron',sans-serif;color:#321d47;margin-bottom:10px;font-size:1.4rem;">Check Your Email!</h2>
      <p style="color:#5a4a6a;line-height:1.7;margin-bottom:8px;">We sent a verification link to:</p>
      <p style="font-weight:700;color:#b06fd0;margin-bottom:20px;word-break:break-all;">${escHtml(email)}</p>
      <p style="color:#7a5a9a;font-size:0.9rem;line-height:1.6;margin-bottom:24px;">Click the link in your email to verify your account. Check your spam folder if you don't see it.</p>
      <button id="verifyGotItBtn" style="background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;border:none;border-radius:30px;padding:12px 32px;font-family:'Orbitron',sans-serif;font-weight:700;font-size:0.9rem;cursor:pointer;">Got it!</button>
      <p style="margin-top:16px;font-size:0.82rem;color:#9a8aaa;">Didn't receive it? <a href="#" id="resendVerifyLink" style="color:#b06fd0;font-weight:700;text-decoration:none;">Resend email</a></p>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#verifyGotItBtn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#resendVerifyLink').addEventListener('click', async (ev) => {
    ev.preventDefault();
    await resendVerificationByEmail(email);
  });
}

// ─── Handle Login ─────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  clearFieldErrors();

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) { showToast('Please enter your email and password.', 'warning'); return; }

  setLoading('loginSubmit', true);
  try {
    // Step 1: Server-side validation (lock check, bcrypt compare)
    const serverCheck = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (!serverCheck.success) {
      if (serverCheck._status === 403 && serverCheck.error === 'EMAIL_NOT_VERIFIED') {
        hideModal();
        showUnverifiedWarning(email);
        return;
      }
      if (serverCheck._status === 423) showToast(serverCheck.error, 'warning');
      else showToast(serverCheck.error || 'Login failed. Please try again.', 'error');
      return;
    }

    // Step 2: Sign in via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      const msgMap = {
        'Invalid login credentials': 'Invalid email or password.',
        'Email not confirmed':        'Please verify your email before signing in.',
        'Too many requests':          'Too many attempts. Please try again later.'
      };
      showToast(msgMap[authError.message] || authError.message || 'Login failed.', 'error');
      return;
    }

    // Step 3: Fetch full profile
    const token   = authData.session.access_token;
    const profile = await apiFetch('/auth/me', { method: 'GET' }, token);

    if (profile.success) {
      currentUser = profile.data;
      cacheUser(currentUser);
      hideModal();
      updateUIForLoggedInUser(currentUser);
      showToast(`Welcome back, ${currentUser.name.split(' ')[0]}! 👋`, 'success');
      setTimeout(() => {
        window.location.href = currentUser.role === 'admin'
          ? '/pages/admin-dashboard.html'
          : '/pages/dashboard.html';
      }, 1500);
    } else {
      await supabase.auth.signOut();
      showToast('Could not load your profile. Please try again.', 'error');
    }

  } catch (err) {
    console.error('Login error:', err);
    showToast('Login failed. Please try again.', 'error');
  } finally {
    setLoading('loginSubmit', false);
  }
}

function showUnverifiedWarning(email) {
  const overlay = document.createElement('div');
  overlay.id = 'unverifiedOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(30,10,50,0.7);backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:40px 32px;max-width:460px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(80,20,120,0.3);">
      <div style="font-size:3rem;margin-bottom:16px;">⚠️</div>
      <h2 style="font-family:'Orbitron',sans-serif;color:#321d47;margin-bottom:10px;font-size:1.3rem;">Email Not Verified</h2>
      <p style="color:#5a4a6a;line-height:1.7;margin-bottom:20px;">Please verify your email address before signing in.<br><strong style="color:#b06fd0;">${escHtml(email)}</strong></p>
      <button id="resendBtn" style="background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;border:none;border-radius:30px;padding:12px 32px;font-family:'Orbitron',sans-serif;font-weight:700;font-size:0.9rem;cursor:pointer;margin-bottom:12px;display:block;width:100%;">Resend Verification Email</button>
      <button id="cancelBtn" style="background:none;border:2px solid rgba(200,170,230,0.4);color:#7a5a9a;border-radius:30px;padding:10px 28px;font-family:'Nunito',sans-serif;font-weight:700;font-size:0.9rem;cursor:pointer;">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#resendBtn').addEventListener('click', async () => {
    await resendVerificationByEmail(email);
    overlay.remove();
  });
  overlay.querySelector('#cancelBtn').addEventListener('click', () => overlay.remove());
}

// ─── Forgot Password ──────────────────────────────────────────────────────────
async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgotEmail')?.value?.trim();
  if (!email) { showToast('Please enter your email.', 'warning'); return; }

  setLoading('forgotSubmit', true);
  try {
    await apiFetch('/auth/forgotpassword', { method: 'POST', body: JSON.stringify({ email }) });
    showToast('If that email is registered, a reset link has been sent!', 'success');
    setTimeout(() => switchAuthTab('login'), 2500);
  } catch {
    showToast('Could not send email. Please try again.', 'error');
  } finally {
    setLoading('forgotSubmit', false);
  }
}

// ─── Resend Verification ──────────────────────────────────────────────────────
async function resendVerificationByEmail(email) {
  try {
    await apiFetch('/auth/resend-verification-by-email', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    showToast('Verification email sent! Check your inbox.', 'success');
  } catch {
    showToast('Could not send email. Please try again.', 'error');
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch { /* best-effort */ }
  await supabase.auth.signOut();
  clearCachedUser();
  currentUser = null;
  window.location.href = '/';
}

// ─── Social login placeholder ─────────────────────────────────────────────────
function socialLogin(provider) {
  showToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} login coming soon!`, 'info');
}

// ─── Update UI after login ────────────────────────────────────────────────────
function updateUIForLoggedInUser(user) {
  const pill = document.getElementById('signupPillBtn');
  if (pill) {
    const firstName = user.name.split(' ')[0];
    const initials  = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    pill.innerHTML = user.profile?.avatar
      ? `<img src="${escHtml(user.profile.avatar)}" alt="${escHtml(firstName)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:6px;vertical-align:middle;"> ${escHtml(firstName)}`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;font-size:0.75rem;font-weight:700;margin-right:6px;">${escHtml(initials)}</span>${escHtml(firstName)}`;
    pill.onclick = () => { window.location.href = '/pages/dashboard.html'; };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const textEl = btn.querySelector('.btn-text');
  const spinEl = btn.querySelector('.loading-spinner');
  btn.disabled = loading;
  if (textEl) textEl.style.display = loading ? 'none' : 'inline';
  if (spinEl) spinEl.style.display = loading ? 'inline-block' : 'none';
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
}

function handleApiErrors(data) {
  if (data.errors && Array.isArray(data.errors)) {
    data.errors.forEach(e => showToast(e.msg, 'error'));
  } else {
    showToast(data.error || 'Something went wrong.', 'error');
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const iconEl = toast.querySelector('.toast-icon');
  const msgEl  = toast.querySelector('.toast-message');
  if (iconEl) iconEl.textContent = icons[type] || 'ℹ️';
  if (msgEl)  msgEl.textContent  = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 4500);
}

// ─── Globals (for inline onclick handlers in HTML) ────────────────────────────
window.logout         = logout;
window.showModal      = showModal;
window.hideModal      = hideModal;
window.switchAuthTab  = switchAuthTab;
window.socialLogin    = socialLogin;
window.getAccessToken = getAccessToken;
window.apiFetch       = apiFetch;