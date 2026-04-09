/**
 * js/auth.js
 * Learnove Authentication Client (Supabase) — Updated
 *
 * Auth flow:
 *  1. User registers (student/instructor) → POST /api/auth/register
 *  2. User logs in → POST /api/auth/login (server validates) →
 *     supabase.auth.signInWithPassword() → session returned
 *  3. Every API call → getAccessToken() sent as Bearer header
 *
 * Security decisions:
 *  • Sessions managed by Supabase SDK (sessionStorage — cleared on tab close)
 *  • No secrets in frontend — only the anon key (locked by RLS)
 *  • Profile cached in sessionStorage
 *  • Profile editable only once (enforced server-side via edit_count column)
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

let currentUser = null;

// ─── DOMContentLoaded ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initModal();
  initForms();

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
      resetPillToSignup();
    }
  });

  // Check URL action params
  const action = new URLSearchParams(window.location.search).get('action');
  if (action === 'login')  showModal('login');
  if (action === 'signup') showModal('signup');

  // Restore from session cache for instant UI
  const cached = getCachedUser();
  if (cached) updateUIForLoggedInUser(cached);
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
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  const formMap = { signup: 'signupForm', login: 'loginForm', forgot: 'forgotPasswordForm' };
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

// ─── Forms ────────────────────────────────────────────────────────────────────
function initForms() {
  document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('forgotPasswordForm')?.addEventListener('submit', handleForgotPassword);
}

// ─── Handle Signup (Student & Instructor) ─────────────────────────────────────
async function handleSignup(e) {
  e.preventDefault();

  const role = document.getElementById('accountTypeInput')?.value || 'student';

  if (role === 'student') {
    await handleStudentSignup();
  } else {
    await handleInstructorSignup();
  }
}

async function handleStudentSignup() {
  const firstName        = document.getElementById('sFirstName')?.value.trim();
  const lastName         = document.getElementById('sLastName')?.value.trim();
  const name             = `${firstName} ${lastName}`.trim();
  const email            = document.getElementById('sEmail')?.value.trim();
  const password         = document.getElementById('signupPassword')?.value;
  const confirmPassword  = document.getElementById('signupConfirmPassword')?.value;
  const dob              = document.getElementById('sDob')?.value;
  const gender           = document.getElementById('sGender')?.value;
  const nationality      = document.getElementById('sNationality')?.value;
  const country          = document.getElementById('sCountry')?.value;
  const phoneCode        = document.getElementById('sPhoneCode')?.value || '';
  const phone            = (phoneCode + document.getElementById('sPhone')?.value).trim();
  const state            = document.getElementById('sState')?.value.trim();
  const city             = document.getElementById('sCity')?.value.trim();
  const postalCode       = document.getElementById('sPostalCode')?.value.trim();
  const address          = document.getElementById('sAddress')?.value.trim();
  const educationLevel   = document.getElementById('sEducationLevel')?.value;
  const institution      = document.getElementById('sInstitution')?.value.trim();
  const major            = document.getElementById('sMajor')?.value.trim();
  const graduationYear   = document.getElementById('sGraduationYear')?.value || null;
  const studentId        = document.getElementById('sStudentId')?.value.trim();
  const idType           = document.getElementById('sIdType')?.value;
  const idNumber         = document.getElementById('sIdNumber')?.value.trim();
  const securityQuestion = document.getElementById('sSecurityQuestion')?.value;
  const securityAnswer   = document.getElementById('sSecurityAnswer')?.value.trim();

  setLoading('signupSubmit', true);
  try {
    const payload = {
      name, email, password, confirmPassword,
      accountType: 'student',
      role: 'student',
      dob, gender, nationality, country,
      phone, state, city, postalCode, address,
      educationLevel, institution, major, graduationYear, studentId,
      idType, idNumber,
      securityQuestion, securityAnswer
    };
    if (window._avatarBase64) payload.avatar = window._avatarBase64;
    if (window._idFileBase64) payload.idDocument = window._idFileBase64;

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

async function handleInstructorSignup() {
  const title          = document.getElementById('iTitle')?.value;
  const firstName      = document.getElementById('iFirstName')?.value.trim();
  const lastName       = document.getElementById('iLastName')?.value.trim();
  const name           = `${title ? title + ' ' : ''}${firstName} ${lastName}`.trim();
  const email          = document.getElementById('iEmail')?.value.trim();
  const password       = document.getElementById('iPassword')?.value;
  const confirmPw      = document.getElementById('iConfirmPassword')?.value;
  const accessToken    = document.getElementById('iAccessToken')?.value.trim();
  const designation    = document.getElementById('iDesignation')?.value;
  const phoneCode      = document.getElementById('iPhoneCode')?.value || '';
  const phone          = (phoneCode + document.getElementById('iPhone')?.value).trim();
  const department     = document.getElementById('iDepartment')?.value.trim();
  const subjects       = document.getElementById('iSubjects')?.value.trim();
  const experience     = document.getElementById('iExperience')?.value;
  const qualification  = document.getElementById('iQualification')?.value;
  const qualInstitution = document.getElementById('iQualInstitution')?.value.trim();
  const nin            = document.getElementById('iNin')?.value.trim();
  const bio            = document.getElementById('iBio')?.value.trim();
  const dob            = document.getElementById('iDob')?.value;
  const secQ           = document.getElementById('iSecurityQuestion')?.value;
  const secA           = document.getElementById('iSecurityAnswer')?.value.trim();

  setLoading('instructorSubmit', true);
  try {
    const payload = {
      name, email, password, confirmPassword: confirmPw,
      accountType: 'instructor',
      role: 'instructor_pending',
      accessToken,
      designation, phone, department, subjects,
      experience, qualification, qualInstitution,
      nin, bio, dob,
      securityQuestion: secQ, securityAnswer: secA
    };
    if (window._iAvatarBase64) payload.avatar = window._iAvatarBase64;
    if (window._iCertBase64) payload.certificateDocument = window._iCertBase64;
    if (window._iIdBase64) payload.idDocument = window._iIdBase64;

    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });

    if (data.success) {
      hideModal();
      showInstructorPendingNotice(email);
    } else {
      handleApiErrors(data);
    }
  } catch (err) {
    console.error('Instructor signup error:', err);
    showToast('Connection error. Please check your internet and try again.', 'error');
  } finally {
    setLoading('instructorSubmit', false);
  }
}

function showVerificationNotice(email) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(30,10,50,.7);backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:40px 32px;max-width:460px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(80,20,120,.3);">
      <div style="font-size:3rem;margin-bottom:16px;">📧</div>
      <h2 style="font-family:'Orbitron',sans-serif;color:#321d47;margin-bottom:10px;font-size:1.4rem;">Check Your Email!</h2>
      <p style="color:#5a4a6a;line-height:1.7;margin-bottom:8px;">We sent a verification link to:</p>
      <p style="font-weight:700;color:#b06fd0;margin-bottom:20px;word-break:break-all;">${escHtml(email)}</p>
      <p style="color:#7a5a9a;font-size:.9rem;line-height:1.6;margin-bottom:24px;">Click the link in your email to verify your account. Check your spam folder if you don't see it.</p>
      <button onclick="this.closest('div').parentElement.remove()" style="background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;border:none;border-radius:30px;padding:12px 32px;font-family:'Orbitron',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;">Got it!</button>
    </div>`;
  document.body.appendChild(overlay);
}

function showInstructorPendingNotice(email) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(30,10,50,.7);backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:40px 32px;max-width:480px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(80,20,120,.3);">
      <div style="font-size:3rem;margin-bottom:16px;">⏳</div>
      <h2 style="font-family:'Orbitron',sans-serif;color:#321d47;margin-bottom:10px;font-size:1.3rem;">Application Submitted!</h2>
      <p style="color:#5a4a6a;line-height:1.7;margin-bottom:12px;">Your instructor application has been received. Our administration team will review your credentials and documents.</p>
      <div style="background:rgba(200,170,230,.1);border:1px solid rgba(176,111,208,.25);border-radius:12px;padding:12px 16px;margin-bottom:20px;font-size:.85rem;color:#4a2e6a;text-align:left;">
        <p style="margin-bottom:6px;font-weight:700;">What happens next?</p>
        <p>1. Verify your email at <strong>${escHtml(email)}</strong></p>
        <p>2. Admin reviews your documents (1–3 business days)</p>
        <p>3. You'll receive approval notification</p>
        <p>4. Approved badge appears on your profile</p>
      </div>
      <button onclick="this.closest('div').parentElement.remove()" style="background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;border:none;border-radius:30px;padding:12px 32px;font-family:'Orbitron',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;">Understood</button>
    </div>`;
  document.body.appendChild(overlay);
}

// ─── Handle Login ─────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) { showToast('Please enter your email and password.', 'warning'); return; }

  setLoading('loginSubmit', true);
  try {
    // Step 1: Server-side validation
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

    // Step 2: Supabase Auth sign-in
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      const msgMap = {
        'Invalid login credentials': 'Invalid email or password.',
        'Email not confirmed': 'Please verify your email before signing in.',
        'Too many requests': 'Too many attempts. Please try again later.'
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
        if (currentUser.role === 'admin') window.location.href = '/pages/admin-dashboard.html';
        else window.location.href = '/pages/dashboard.html';
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
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(30,10,50,.7);backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="background:white;border-radius:24px;padding:40px 32px;max-width:460px;width:100%;text-align:center;box-shadow:0 32px 80px rgba(80,20,120,.3);">
      <div style="font-size:3rem;margin-bottom:16px;">⚠️</div>
      <h2 style="font-family:'Orbitron',sans-serif;color:#321d47;margin-bottom:10px;font-size:1.3rem;">Email Not Verified</h2>
      <p style="color:#5a4a6a;line-height:1.7;margin-bottom:20px;">Please verify your email before signing in.<br><strong style="color:#b06fd0;">${escHtml(email)}</strong></p>
      <button id="resendBtn" style="background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;border:none;border-radius:30px;padding:12px 32px;font-family:'Nunito',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;margin-bottom:12px;display:block;width:100%;">Resend Verification Email</button>
      <button id="cancelBtn" style="background:none;border:2px solid rgba(200,170,230,.4);color:#7a5a9a;border-radius:30px;padding:10px 28px;font-family:'Nunito',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;">Cancel</button>
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
  resetPillToSignup();
  document.getElementById('drawerLogoutItem') && (document.getElementById('drawerLogoutItem').style.display = 'none');
  window.location.href = '/';
}

// ─── Social login placeholder ─────────────────────────────────────────────────
function socialLogin(provider) {
  showToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} login coming soon!`, 'info');
}

// ─── Update UI after login ────────────────────────────────────────────────────
function updateUIForLoggedInUser(user) {
  const pill = document.getElementById('signupPillBtn');
  if (!pill) return;

  const firstName = user.name.split(' ')[0];
  const initials  = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const avatarSrc = user.profile?.avatar || user.avatar || null;

  // Build pill content
  pill.innerHTML = avatarSrc
    ? `<img src="${escHtml(avatarSrc)}" alt="${escHtml(firstName)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.6);"> <span style="font-weight:700">${escHtml(firstName)}</span>`
    : `<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#b06fd0,#80b8f0);color:white;font-size:.75rem;font-weight:700;">${escHtml(initials)}</span> <span style="font-weight:700">${escHtml(firstName)}</span>`;

  pill.dataset.loggedIn = 'true';
  pill.style.gap = '8px';

  // Update dropdown header
  const pdAvatarWrap = document.getElementById('pdAvatarWrap');
  if (pdAvatarWrap) {
    pdAvatarWrap.innerHTML = avatarSrc
      ? `<img src="${escHtml(avatarSrc)}" class="pd-avatar" alt="${escHtml(user.name)}">`
      : `<div class="pd-avatar-placeholder">${escHtml(initials)}</div>`;
  }
  const pdName  = document.getElementById('pdName');
  const pdEmail = document.getElementById('pdEmail');
  const pdBadge = document.getElementById('pdBadge');
  if (pdName)  pdName.textContent  = user.name;
  if (pdEmail) pdEmail.textContent = user.email;
  if (pdBadge) {
    const roleMap = {
      admin: '⚡ Admin',
      instructor: '👨‍🏫 Instructor',
      instructor_pending: '⏳ Pending Approval',
      student: '🎓 Student',
      user: '👤 User'
    };
    pdBadge.textContent = roleMap[user.role] || '👤 User';
  }

  // Show logout in drawer
  const drawerLogout = document.getElementById('drawerLogoutItem');
  if (drawerLogout) drawerLogout.style.display = 'flex';

  // Edit profile button — one-time edit enforcement
  const pdEditBtn = document.getElementById('pdEditBtn');
  if (pdEditBtn) {
    if (user.profile?.edit_count >= 1) {
      pdEditBtn.style.opacity = '0.5';
      pdEditBtn.style.pointerEvents = 'none';
      pdEditBtn.title = 'Profile can only be edited once for security reasons';
      pdEditBtn.querySelector('.pdi').textContent = '🔒';
      pdEditBtn.childNodes[1].textContent = ' Profile Locked';
    } else {
      pdEditBtn.href = '/pages/dashboard.html?edit=true';
    }
  }
}

function resetPillToSignup() {
  const pill = document.getElementById('signupPillBtn');
  if (!pill) return;
  pill.innerHTML = '<span class="signup-pill-text">Sign up ›</span>';
  pill.dataset.loggedIn = 'false';
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

// ─── Globals ──────────────────────────────────────────────────────────────────
window.logout         = logout;
window.showModal      = showModal;
window.hideModal      = hideModal;
window.switchAuthTab  = switchAuthTab;
window.socialLogin    = socialLogin;
window.getAccessToken = getAccessToken;
window.apiFetch       = apiFetch;