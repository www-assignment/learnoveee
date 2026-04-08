# 🚀 Learnove — Complete Setup Guide

## Folder Structure

```
LEARNOVE/
├── frontend/
│   ├── js/
│   │   ├── auth.js               ✅ (your existing file)
│   │   └── supabase-config.js    ✅ (fill in your keys)
│   ├── pages/
│   │   ├── dashboard.html        ✅
│   │   ├── reset-password.html   ✅
│   │   └── verify-email.html     ✅
│   ├── index.html                ✅
│   ├── Logo.png                  ✅
│   └── centered-img.avif         ✅
├── functions/
│   ├── src/
│   │   ├── middleware/
│   │   │   └── auth.js           ✅ (Supabase JWT middleware)
│   │   ├── routes/
│   │   │   └── auth.js           ✅ (all auth endpoints)
│   │   ├── utils/
│   │   │   └── emailService.js   ✅ (Nodemailer)
│   │   ├── supabaseAdmin.js      ✅ (server-side Supabase client)
│   │   └── index.js              ✅ (Express app entry)
│   └── package.json              ✅
├── supabase-schema.sql           ✅ (run this in Supabase)
├── .env.example                  ✅ (copy → .env, fill in secrets)
├── .gitignore                    ✅
└── SETUP.md                      ← you are here
```

---

## Step 1 — Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign in / create account.
2. Click **"New project"**.
3. Give it a name (e.g. `learnove`), choose a region close to Nigeria (e.g. `eu-west-2` London or `us-east-1`), set a strong database password, click **Create project**.
4. Wait ~2 minutes for the project to spin up.

---

## Step 2 — Get Your Supabase Keys

In your Supabase dashboard go to **Settings → API**. You'll need:

| Key | Where to put it |
|---|---|
| **Project URL** (looks like `https://xxxx.supabase.co`) | `.env` → `SUPABASE_URL` AND `frontend/js/supabase-config.js` → `SUPABASE_URL` |
| **anon / public key** | `frontend/js/supabase-config.js` → `SUPABASE_ANON_KEY` |
| **service_role / secret key** | `.env` → `SUPABASE_SERVICE_ROLE_KEY` (**never in frontend!**) |

---

## Step 3 — Run the Database Schema

1. In Supabase dashboard, go to **SQL Editor → New Query**.
2. Open the file `LEARNOVE/supabase-schema.sql`.
3. Copy the entire contents and paste into the SQL editor.
4. Click **Run** (▶).

You should see `Success. No rows returned.` — this means your tables and policies were created.

---

## Step 4 — Configure Supabase Auth Settings

In Supabase dashboard go to **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:5500` (change to your domain in production)
- **Redirect URLs** — add all of these:
  ```
  http://localhost:5500/pages/verify-email.html
  http://localhost:5500/pages/reset-password.html
  http://127.0.0.1:5500/pages/verify-email.html
  http://127.0.0.1:5500/pages/reset-password.html
  ```
  (Add your production domain URLs here too when you deploy.)

Then go to **Authentication → Email Templates** if you want to disable Supabase's default emails (since we send our own branded ones via Nodemailer). You can leave them on — users may get two emails, or you can disable Supabase's emails by setting **"Confirm email"** to custom SMTP in **Project Settings → Auth**.

---

## Step 5 — Set Up Gmail App Password (for sending emails)

1. Go to your Google Account → **Security → 2-Step Verification** (must be ON).
2. Go to **Security → App passwords**.
3. Create a new app password — name it "Learnove".
4. Google will give you a 16-character password. Copy it.

This goes in your `.env` as `EMAIL_PASS`.

---

## Step 6 — Create Your `.env` File

In the root `LEARNOVE/` folder:

```bash
# On Mac/Linux:
cp .env.example .env

# On Windows (Command Prompt):
copy .env.example .env
```

Open `.env` and fill in your real values:

```env
NODE_ENV=development
PORT=4000

SUPABASE_URL=https://your-actual-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-actual-service-role-key

FRONTEND_URL=http://localhost:5500
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500

EMAIL_SERVICE=gmail
EMAIL_USER=youremail@gmail.com
EMAIL_PASS=your-16-char-app-password
EMAIL_FROM_NAME=Learnove
```

---

## Step 7 — Fill In Frontend Config

Open `frontend/js/supabase-config.js` and replace the placeholders:

```javascript
export const SUPABASE_URL      = 'https://your-actual-ref.supabase.co';
export const SUPABASE_ANON_KEY = 'your-anon-key-here';
export const API_URL           = 'http://localhost:4000/api';
```

---

## Step 8 — Install Backend Dependencies

Open a terminal and navigate to the `functions` folder:

```bash
cd LEARNOVE/functions
npm install
```

This installs all packages listed in `package.json`.

---

## Step 9 — Start the Backend Server

Still in the `LEARNOVE/functions` folder:

```bash
# Development (auto-restarts on file changes):
npm run dev

# Or plain start:
npm start
```

You should see:
```
🚀 Learnove API running on http://localhost:4000
   Environment : development
   Health check: http://localhost:4000/api/health
```

Test it by visiting: [http://localhost:4000/api/health](http://localhost:4000/api/health)

---

## Step 10 — Serve the Frontend

You need a local HTTP server for the frontend (not just opening the HTML file directly — CORS and ES modules won't work with `file://`).

**Option A — VS Code Live Server** (easiest):
1. Install the "Live Server" extension in VS Code.
2. Right-click `frontend/index.html` → **Open with Live Server**.
3. It opens at `http://127.0.0.1:5500`.

**Option B — Node `serve` package**:
```bash
npx serve LEARNOVE/frontend -l 5500
```

**Option C — Python** (if you have Python 3):
```bash
cd LEARNOVE/frontend
python -m http.server 5500
```

---

## Step 11 — Test the Full Flow

With both the backend (`localhost:4000`) and frontend (`localhost:5500`) running:

1. Open [http://localhost:5500](http://localhost:5500)
2. Click **Sign up** — create an account
3. Check your email for the verification link
4. Click the link — it opens `verify-email.html` and confirms your account
5. Sign in via the login form
6. You should be redirected to the dashboard

---

## Common Issues & Fixes

### ❌ "CORS error" in browser console
Make sure `ALLOWED_ORIGINS` in `.env` exactly matches the URL shown in your browser address bar (including `http://` and port).

### ❌ "Missing SUPABASE_URL" error when starting backend
You haven't created the `.env` file, or the backend can't find it. Make sure `.env` is in the **root `LEARNOVE/` folder** (not inside `functions/`).

### ❌ Emails not sending
- Check `EMAIL_USER` and `EMAIL_PASS` in `.env`.
- Make sure you're using a Gmail **App Password**, not your regular Gmail password.
- Make sure 2-Step Verification is ON in your Google account.
- Check your spam folder.

### ❌ "Invalid or expired session" on API calls
Make sure the `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `supabase-config.js` match exactly what's in your Supabase dashboard.

### ❌ Verification link doesn't work / shows "Invalid Link"
Go to Supabase Dashboard → **Authentication → URL Configuration** and make sure `http://localhost:5500/pages/verify-email.html` is in the **Redirect URLs** list.

### ❌ Login says "EMAIL_NOT_VERIFIED" even after clicking verify link
The verify-email.html page calls `POST /api/auth/confirm-email` to sync the verification status to our `profiles` table. Check browser console for any errors on that page.

---

## Production Deployment Checklist

When you're ready to deploy (e.g. to Render, Railway, or Fly.io for backend; Netlify or Vercel for frontend):

- [ ] Set `NODE_ENV=production` in backend environment
- [ ] Update `FRONTEND_URL` to your real domain
- [ ] Update `ALLOWED_ORIGINS` to your real domain
- [ ] Update `API_URL` in `frontend/js/supabase-config.js` to your deployed backend URL
- [ ] Add your production domain URLs to Supabase Auth → Redirect URLs
- [ ] Update Supabase Auth → Site URL to your production domain
- [ ] Never commit `.env` to git (it's already in `.gitignore`)

---

## Summary of All Commands

```bash
# 1. Copy env file
cp LEARNOVE/.env.example LEARNOVE/.env
# (then fill in your values)

# 2. Install backend dependencies
cd LEARNOVE/functions
npm install

# 3. Start backend
npm run dev

# 4. Serve frontend (in a new terminal)
cd LEARNOVE/frontend
npx serve . -l 5500
```

That's it! 🎉
