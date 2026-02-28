# Qrew — Housing Workforce
**Developer:** Elder Systems · **Client:** Housing Opportunities Inc. (HOI)

Mobile-first workforce time-clock application. Workers clock in and out at managed worksites. GPS verifies on-site presence. ED and PDs manage sites, review time, and export to QuickBooks.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Before You Deploy — Prerequisites](#before-you-deploy--prerequisites)
3. [Step 1 — Firebase Project Setup](#step-1--firebase-project-setup)
4. [Step 2 — Environment Variables](#step-2--environment-variables)
5. [Step 3 — Firestore Security Rules](#step-3--firestore-security-rules)
6. [Step 4 — Build and Deploy](#step-4--build-and-deploy)
7. [Step 5 — First-Time Firestore Bootstrap](#step-5--first-time-firestore-bootstrap)
8. [QuickBooks Online Integration](#quickbooks-online-integration)
9. [Real-Life Testing Checklist](#real-life-testing-checklist)
10. [Daily Operations Guide](#daily-operations-guide)
11. [Common Errors and Fixes](#common-errors-and-fixes)

---

## How It Works

### Roles
| Role | What they can do |
|------|-----------------|
| **ED** (Executive Director) | Create users, worksites, reports, view audit log, everything |
| **PD** (Program Director) | Start/end days at assigned worksites, view their sites and crew |
| **TECH / COORD / TO** (Workers) | Clock in and out only |

### A Typical Workday
1. **PD starts the day** on a worksite → site is now "open"
2. **Workers clock in** — GPS verifies they are within 100 ft of the site
3. Workers clock out when done (on their own, or automatically when day ends)
4. **PD ends the day** → all open shifts are force-closed, no more clock-ins allowed
5. Time is recorded. ED runs reports and exports to QuickBooks.

### GPS Verification
- When a worker taps **Clock In**, the app requests their browser/device location
- If they are more than 100 feet from the worksite, they are **blocked** with an error
- Worksite coordinates are set automatically when a site is created or edited (geocoded from the address via OpenStreetMap — no API key required)
- Existing worksites without coordinates: open and re-save them in the Sites page

---

## Before You Deploy — Prerequisites

You need the following before starting:

- [ ] A **Firebase project** (free Spark plan works; Blaze plan needed for Cloud Functions)
- [ ] A **Google Workspace domain** for HOI (`housingopps.org`) — staff sign in with their work Google accounts
- [ ] **Node.js 18+** installed on your machine
- [ ] **Firebase CLI** installed: `npm install -g firebase-tools`
- [ ] **Git** and the Qrew repository cloned locally

Verify tools:
```bash
node --version    # 18.x or higher
firebase --version
```

---

## Step 1 — Firebase Project Setup

### 1a. Create the Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `hoi-time-clock` (or your preferred name)
3. Disable Google Analytics (not needed) → **Create project**

### 1b. Enable Authentication
1. In Firebase Console → **Authentication** → **Get started**
2. Click **Sign-in method** → enable **Google**
3. Set **Project support email** to your ED email
4. Save

### 1c. Restrict Sign-in to HOI Domain Only
The app enforces `housingopps.org` domain in code via the `hd` OAuth parameter. No additional Firebase config is needed for this.

### 1d. Enable Firestore
1. Firebase Console → **Firestore Database** → **Create database**
2. Select **Start in production mode** (rules are deployed separately)
3. Choose a region close to your users (e.g., `us-east1`)

### 1e. Get Your Web App Config
1. Firebase Console → **Project Settings** (gear icon) → **Your apps**
2. Click **Add app** → choose **Web** → register the app
3. Copy the `firebaseConfig` object — you'll need these values in the next step

---

## Step 2 — Environment Variables

The app lives in the `Qrew/` subfolder. Create the environment file there:

```bash
# From repo root:
cp .env.example Qrew/.env.local
```

Then open `Qrew/.env.local` and fill in the Firebase values from Step 1e:

```env
# ── FIREBASE CLIENT (from Firebase Console > Your Apps) ──────────────────────
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=hoi-time-clock.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=hoi-time-clock
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=hoi-time-clock.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=177191...
NEXT_PUBLIC_FIREBASE_APP_ID=1:177191...:web:abc123

# ── HOI CONFIGURATION ────────────────────────────────────────────────────────
NEXT_PUBLIC_HOI_WORKSPACE_DOMAIN=housingopps.org
NEXT_PUBLIC_ED_EMAIL=director@housingopps.org
```

**The Firebase values above are the only ones required to run the app.** The QBO (QuickBooks), Admin SDK, and Calendar variables can be filled in later when those integrations are activated.

> **Important:** Never commit `.env.local` to git. It is already in `.gitignore`.

---

## Step 3 — Firestore Security Rules

The rules are in `firestore.rules` at the repo root. Deploy them to Firestore before any users sign in.

```bash
# From repo root (where firebase.json lives):
firebase login       # Only needed the first time
firebase use --add   # Select your Firebase project

firebase deploy --only firestore:rules
```

This grants read/write access based on role. Workers can only create punches; EDs have full access; audit logs are write-only for all and read-only for ED.

---

## Step 4 — Build and Deploy

The Next.js app is in the `Qrew/` folder. It builds to a static `out/` folder that Firebase Hosting serves.

### 4a. Ensure Static Export is Configured
The `next.config.js` at the repo root already has `output: 'export'`. Copy it into the app folder so the build picks it up:

```bash
# From repo root:
cp next.config.js Qrew/next.config.js
```

### 4b. Install Dependencies and Build
```bash
cd Qrew
npm install
npm run build
# This creates Qrew/out/ — the production-ready static files
cd ..
```

### 4c. Update firebase.json Public Path
Open `firebase.json` at the repo root and change the `"public"` path:

```json
{
  "hosting": {
    "public": "Qrew/out",
    ...
  }
}
```

### 4d. Deploy to Firebase Hosting
```bash
# From repo root:
firebase deploy --only hosting
```

Your app is now live at `https://hoi-time-clock.web.app` (or your custom domain).

To deploy Firestore rules at the same time:
```bash
firebase deploy --only hosting,firestore:rules
```

---

## Step 5 — First-Time Firestore Bootstrap

After deploying, you need to manually create the first ED (Executive Director) account. This is the bootstrap problem: no one has admin access yet.

### 5a. Sign In with Your ED Google Account
Go to your deployed app URL and sign in with the ED's Google account (`director@housingopps.org` or whoever the ED is). Firebase Auth will create an entry for them.

### 5b. Find the UID
1. Firebase Console → **Authentication** → **Users**
2. Find the ED's email and copy their **UID** (looks like `abc123XYZ...`)

### 5c. Create the User Document in Firestore
1. Firebase Console → **Firestore** → **users** collection
2. Click **Add document** → use the **exact UID** from step 5b as the Document ID
3. Add these fields:

| Field | Type | Value |
|-------|------|-------|
| `email` | string | `director@housingopps.org` |
| `displayName` | string | Director's full name |
| `role` | string | `ED` |
| `active` | boolean | `true` |
| `managerWorksites` | array | *(empty)* |
| `googleSubject` | string | *(same as the UID)* |
| `createdAt` | timestamp | *(click the timestamp option)* |

4. Click **Save**

**Sign out and sign back in.** The ED account is now active. All other users can be created from within the app (Admin panel).

### 5d. Add Other Users (From the App)
1. Sign in as ED
2. Go to **Admin** tab
3. Add each staff member by their `@housingopps.org` email and assign a role (PD, TECH, COORD, or TO)
4. They sign in using their Google Work account — the app recognizes them automatically

---

## QuickBooks Online Integration

Qrew can push approved shift data to QBO as **TimeActivity** records, feeding directly into your QuickBooks payroll workflow. The integration is optional — the rest of the app works without it.

### How the QBO Flow Works

```
Connect QBO → Sync rosters → Map workers & sites → Approve shifts → Push to QBO
```

1. **Connect** — ED opens Admin → QuickBooks and authenticates via Intuit OAuth 2.0.
2. **Sync** — Pull the current Employee, Customer (job), and Class lists from QBO into Qrew's cache.
3. **Map** — In the Mappings tab, link each Qrew worker to a QBO Employee/Vendor and each worksite to a QBO Customer (job).
4. **Approve** — ED opens Reports → Payroll, selects the pay period, and approves completed shifts.
5. **Push** — Click "Push to QBO" on each approved shift. It becomes a TimeActivity in QBO.
6. **Retry** — If any pushes fail (rate limit, mapping gap), use Retry Failed in Admin → QBO.

### Setup (New Deployment)

#### 1. Intuit Developer App

1. Sign in at [developer.intuit.com](https://developer.intuit.com)
2. Create an app → select **Accounting** scope
3. Copy **Client ID** and **Client Secret** from Keys & Credentials
4. Add your Redirect URI:
   - Production: `https://your-domain.web.app/api/qbo/callback`
   - Local dev: `http://localhost:3000/api/qbo/callback`

#### 2. Environment Variables

Add these to `Qrew/.env.local`:

```env
# Intuit Developer credentials
QBO_CLIENT_ID=ABcde1234...
QBO_CLIENT_SECRET=xyz...

# Must match exactly what is registered in the Intuit Developer Portal
QBO_REDIRECT_URI=https://your-domain.web.app/api/qbo/callback

# 'sandbox' for testing, 'production' for real payroll
QBO_ENVIRONMENT=sandbox

# AES-256-GCM encryption key for OAuth tokens stored in Firestore
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
QBO_ENCRYPTION_KEY=<64 hex chars>

# HMAC secret for OAuth state parameter (CSRF protection)
# Generate: node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
QBO_OAUTH_STATE_SECRET=<random string ≥32 chars>

# Firestore org document ID (same value in both vars)
QBO_ORG_ID=hoi-housing-opportunities
NEXT_PUBLIC_QBO_ORG_ID=hoi-housing-opportunities

# Payroll timezone for time entry timestamps
QBO_PAYROLL_TIMEZONE=America/New_York
```

#### 3. Create the Organization Document

In Firestore Console, create `organizations/hoi-housing-opportunities`:

| Field | Type | Value |
|-------|------|-------|
| `name` | string | `Housing Opportunities Inc.` |
| `qrewInstance` | string | `Housing Workforce` |
| `domain` | string | `housingopps.org` |
| `createdAt` | timestamp | *(now)* |

#### 4. Deploy Updated Rules

```bash
firebase deploy --only firestore:rules
```

### Day-to-Day Payroll Workflow (ED)

Once a pay period closes:

1. **Admin → QuickBooks → Overview** — verify the connection shows **Connected**
2. Click **Sync → Employees** and **Sync → Customers** to refresh the QBO roster cache
3. Open the **Mappings** tab — confirm every active worker has a QBO Employee assigned and every worksite has a QBO Customer
4. **Reports → Payroll** — set the date range to the pay period
5. Click **Load Shifts** — all completed shifts for the period appear
6. Click **Approve All Pending** (or approve individually)
7. Click **Push to QBO** on each approved shift → it becomes a TimeActivity in QBO
8. If any fail, fix the mapping or connection issue and use **Retry Failed** in Admin → QBO

### Token Security

OAuth tokens are stored in Firestore encrypted with **AES-256-GCM** using `QBO_ENCRYPTION_KEY`. Plaintext tokens never appear in logs or client-side code. If the key is compromised:
1. Generate a new `QBO_ENCRYPTION_KEY`
2. Disconnect QBO from Admin → QuickBooks (revokes the tokens at Intuit)
3. Reconnect via OAuth (issues fresh tokens encrypted with the new key)

---

## Real-Life Testing Checklist

Run through this before going live with real workers.

### Authentication
- [ ] ED can sign in with `@housingopps.org` Google account
- [ ] Personal Gmail (`@gmail.com`) is rejected at the sign-in screen
- [ ] A new PD or worker can sign in and sees the clock-in UI (not admin)

### Worksite Setup
- [ ] ED creates a worksite with a real address
- [ ] After saving, open and edit the worksite — confirm "Coordinates on file — geo-check active" appears in green under the address field
- [ ] If it says "Coordinates will be geocoded..." instead, the Nominatim lookup may have failed — try a more complete address (include city/state)

### Starting a Day and Clocking In
- [ ] PD (or ED) taps **Start Day** on a worksite → site now shows "OPEN TODAY"
- [ ] Worker (on a phone, physically at the site) opens the app, selects the site, taps **Clock In**
  - Browser asks for location permission → worker taps **Allow**
  - Clock-in succeeds → timer starts
- [ ] Worker taps **Clock Out** → shift is saved with duration
- [ ] Test the 100 ft rule: from inside an office away from the site, tap Clock In → you should see an error with the distance ("~X ft away")

### Ending the Day
- [ ] PD taps **End Day** → confirm dialog appears
- [ ] After confirming, any workers still clocked in are automatically clocked out with `forcedOut: true`
- [ ] Site shows as closed — workers can no longer clock in to it

### Reports (ED Only)
- [ ] ED navigates to **Reports**, generates a timesheet for today
- [ ] Verify names, times, and durations are correct

### Audit Log (ED Only)
- [ ] ED navigates to **Admin → Audit**
- [ ] Confirms clock-in, clock-out, and site events all appear

---

## Daily Operations Guide

### For the Executive Director
**Managing users:** Admin tab → add/remove workers, change roles, toggle active/inactive
**Viewing time:** Reports tab → generate by date range, person, or worksite
**Audit trail:** Admin → Audit — see every clock-in, role change, and site action
**When a worker forgets to clock out:** The PD's "End Day" will auto-close them. Or manually correct in the Firestore `punches` collection.

### For Program Directors
**Starting a workday:**
1. Go to Sites tab (or dashboard Sites tab)
2. Find the worksite → tap **Start Day**
3. Notify your crew — they can now clock in

**Ending a workday:**
1. Sites tab → **End Day** on the open site
2. Confirm the prompt — all active shifts are automatically closed
3. Workers clocked in after this point will see an error

**What if you forget to start the day?** Workers will see no open sites and won't be able to clock in. Just start the day whenever you remember — the start time is recorded accurately.

### For Workers (TECH / COORD / TO)
**Clocking in:**
1. Open the app on your phone
2. Make sure your browser has location permission enabled for this site
3. Select your worksite from the dropdown (if more than one is open)
4. Tap **Clock In** — the timer starts

**Clocking out:**
1. Tap **Clock Out** when you leave the site
2. If you forget, your shift will be auto-closed when the PD ends the day

**Location permission on iPhone (Safari):**
Settings → Safari → Location → Allow
Or when the browser prompts: tap **Allow**

**Location permission on Android (Chrome):**
When the browser prompts: tap **Allow**
Or: Chrome Settings → Site Settings → Location → Allow

---

## Common Errors and Fixes

### Sign-In Errors

**`auth/invalid-api-key`**
Your `.env.local` file is either missing, misnamed, or has the wrong API key.
- Confirm the file is at `Qrew/.env.local` (not `Qrew/.env local` or `Qrew/.env.local.txt`)
- Confirm `NEXT_PUBLIC_FIREBASE_API_KEY` is filled in (not empty)
- Restart the dev server after any `.env.local` change

**`auth/popup-blocked`**
The Google sign-in popup was blocked.
- Allow popups for this site in your browser settings

**User signs in but sees a blank screen or gets redirected to login**
Their Firestore user document doesn't exist yet or `active: false`.
- ED goes to Admin → find the user → ensure they are active and have a role assigned
- Or create their Firestore document manually (see Step 5c format)

**User signs in with a personal Gmail and gets rejected**
This is expected behavior. Only `@housingopps.org` accounts are permitted.

---

### Clock-In Errors

**"Location access is required to clock in"**
The worker denied location permission.
Fix: They need to enable location for the browser:
- iOS Safari: Settings → Safari → Location → Allow
- Android Chrome: site settings → Location → Allow
- Desktop Chrome: click the lock icon in the address bar → Location → Allow

**"You must be within 100 ft of the worksite to clock in"**
Worker is too far from the site. This is the geo-fence working correctly.
If they are actually on-site and still blocked, the worksite coordinates may be slightly off.
Fix: ED or PD opens the worksite in Sites, edits the address to be more specific (include unit number, city, state), and saves — this re-geocodes the coordinates.

**"No worksite selected" or no open sites visible**
No site day has been started for today.
Fix: PD taps **Start Day** on the relevant worksite first.

---

### Deployment Errors

**Build fails with TypeScript errors**
```bash
cd Qrew && npm run build
# Read the error output carefully — usually a type mismatch
```

**`firebase deploy` fails: "Hosting config is required"**
Run firebase deploy from the repo root (where `firebase.json` lives), not from inside `Qrew/`.

**`firebase deploy` says no files in `out/`**
The `firebase.json` `"public"` path doesn't match where the build output went.
Ensure `firebase.json` has `"public": "Qrew/out"` and that `npm run build` completed without errors.

**After deploying, the app shows an old version**
Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac).
Firebase Hosting CDN may cache for a few minutes — this resolves on its own.

---

### Data / Firestore Errors

**"Missing or insufficient permissions"**
Firestore security rules rejected the request.
Common causes:
- User's role in Firestore doesn't match what they're trying to do
- Firestore rules haven't been deployed yet (`firebase deploy --only firestore:rules`)
- The user document is missing from the `users` collection

**Punch recorded but duration shows wrong or "—"**
An IN punch has no matching OUT punch — the shift is still open.
Fix: ED or PD can end the site day (force-closes all open shifts) or manually add an OUT punch in Firestore matching the worker's `userId` and `siteDayId`.

**Worker's shift shows `forcedOut: true` in reports**
The worker was still clocked in when the PD ended the day — their shift was auto-closed at the end time.
This is expected behavior. No action needed unless the time needs to be corrected.

---

### Geocoding / Coordinates Errors

**Worksite shows "Coordinates will be geocoded on save" even after saving**
Nominatim (the geocoding service) couldn't find the address.
Fix: Make the address more specific — include street number, street name, city, state, ZIP. Avoid abbreviations.
Example: Instead of `"123 Main"`, use `"123 Main Street, Baltimore, MD 21201"`.

**The app blocks clock-ins at a valid site (false positive geo block)**
The geocoded coordinates are slightly off for this address.
Fix: Manually find the correct lat/lng for the site (search the address on maps.google.com, right-click → "What's here?" for exact coordinates), then update the Firestore `worksites/{id}` document directly with the correct `lat` and `lng` values.

---

## Project File Reference

```
Qrew/                         ← Firebase project root
├── firebase.json             ← Firebase deploy config (public: "Qrew/out")
├── firestore.rules           ← Firestore security rules (deploy these first)
├── firestore.indexes.json    ← Composite query indexes
├── next.config.js            ← Next.js static export config (output: 'export')
├── functions/                ← Cloud Functions (Calendar sync, QBO retry queue)
├── .env.example              ← Template for environment variables
└── Qrew/                     ← Next.js application
    ├── src/
    │   ├── app/              ← Pages (App Router)
    │   │   ├── page.tsx      ← Login
    │   │   ├── dashboard/    ← Clock in/out, site picker
    │   │   ├── worksites/    ← Site management (ED/PD)
    │   │   ├── reports/      ← Report generation (ED)
    │   │   ├── admin/        ← User management (ED)
    │   │   ├── admin/audit/  ← Audit log (ED)
    │   │   ├── admin/qbo/    ← QuickBooks integration (ED)
    │   │   └── staff/        ← Staff directory (ED)
    │   ├── lib/
    │   │   ├── firebase.ts   ← Firebase init + Google OAuth config
    │   │   ├── db.ts         ← All Firestore read/write functions
    │   │   └── utils.ts      ← Helpers incl. Haversine geo, geocoding
    │   └── types/index.ts    ← TypeScript interfaces for all data models
    ├── public/
    │   └── hoi-logo-square.png  ← HOI logo (shown on login page)
    └── .env.local            ← Your environment variables (never commit this)
```

---

## Firestore Data Model Summary

| Collection | Purpose |
|------------|---------|
| `users` | All staff — role, email, active status |
| `worksites` | Physical sites — name, address, lat/lng, managers |
| `siteDays` | One record per site per day — OPEN or CLOSED |
| `punches` | Raw clock-in/out events — includes GPS coords |
| `shifts` | Derived from punches — final duration records |
| `auditLogs` | Immutable log of every admin action |
| `organizations` | QBO connection and mapping data (ED only) |

---

*Qrew Housing Workforce · Built by Elder Systems · Internal use only — Housing Opportunities Inc.*
