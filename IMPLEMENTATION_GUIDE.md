# HOI Time Clock - Complete Implementation Guide

## Overview

This guide provides step-by-step instructions for deploying and configuring the HOI Time Clock application. The system is a mobile-first time tracking solution with Google Calendar integration, role-based access control, and comprehensive reporting.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                    │
│  - Mobile-first responsive design                           │
│  - Role-based UI (ED/PD/TO)                                 │
│  - Real-time updates via Firestore                          │
│  - PWA-ready for mobile installation                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Firebase Services                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Firebase   │  │  Firestore   │  │ Cloud Functions  │  │
│  │     Auth     │  │   Database   │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────┬────────────────────────────┬─────────────┘
                   │                            │
                   ▼                            ▼
┌─────────────────────────────────┐  ┌────────────────────────┐
│    Google Workspace Domain      │  │  Google Cloud APIs     │
│  - Gmail authentication         │  │  - Calendar API        │
│  - Domain restriction           │  │  - Drive API           │
│  - Service account delegation   │  │  - Service Account     │
└─────────────────────────────────┘  └────────────────────────┘
```

## Phase 1: Prerequisites and Setup (30 minutes)

### Required Accounts and Access

1. **Google Workspace Admin Access**
   - You need admin access to the HOI Google Workspace domain
   - Required for domain delegation and calendar setup

2. **Google Cloud Console Access**
   - Create or access existing GCP project
   - Billing must be enabled for Cloud Functions

3. **Development Environment**
   ```bash
   # Required tools
   node --version  # Should be 18.x or higher
   npm --version   # Should be 9.x or higher
   git --version   # For version control
   
   # Install Firebase CLI globally
   npm install -g firebase-tools
   
   # Verify installation
   firebase --version
   ```

### Project Initialization

```bash
# Clone or create project directory
mkdir hoi-time-clock
cd hoi-time-clock

# Initialize git (recommended)
git init
echo "node_modules
.env.local
.next
out
functions/lib
functions/node_modules
functions/service-account-key.json" > .gitignore
```

## Phase 2: Firebase Project Setup (45 minutes)

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter project name: "hoi-time-clock"
4. Enable Google Analytics (optional but recommended)
5. Wait for project creation

### 2. Enable Firebase Services

```bash
# Login to Firebase
firebase login

# Initialize Firebase in project directory
firebase init

# Select these services:
# [x] Firestore
# [x] Functions
# [x] Hosting
# [ ] Storage (not needed)
# [ ] Emulators (optional for development)

# Use default options for:
# - Firestore rules: firestore.rules
# - Firestore indexes: firestore.indexes.json
# - Functions language: TypeScript
# - Public directory: out
```

### 3. Configure Firebase Authentication

1. In Firebase Console, go to **Authentication**
2. Click "Get started"
3. Enable **Google** sign-in method
4. Add authorized domain: `housingopportunities.org`
5. Save the configuration

### 4. Get Firebase Configuration

1. In Firebase Console, go to **Project settings**
2. Under "Your apps", click the **web icon** (</>)
3. Register app with nickname "HOI Time Clock Web"
4. Copy the configuration object:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "hoi-time-clock.firebaseapp.com",
  projectId: "hoi-time-clock",
  storageBucket: "hoi-time-clock.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

## Phase 3: Google Cloud Configuration (60 minutes)

### 1. Enable Required APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your Firebase project
3. Navigate to **APIs & Services > Library**
4. Search and enable:
   - Google Calendar API
   - Google Drive API
   - Cloud Functions API
   - Cloud Scheduler API

### 2. Create Service Account

```bash
# In Cloud Console > IAM & Admin > Service Accounts
# Click "Create Service Account"

Name: hoi-time-clock-service
ID: hoi-time-clock-service
Description: Service account for Calendar and Drive API access

# Grant roles:
- Calendar API Service Agent
- Drive API Service Agent

# Create and download JSON key
# Save as: functions/service-account-key.json
```

**IMPORTANT**: Add `functions/service-account-key.json` to `.gitignore`!

### 3. Configure Domain-Wide Delegation

This allows the service account to act on behalf of users in your workspace.

1. Go to [Google Workspace Admin Console](https://admin.google.com)
2. Navigate to **Security > Access and data control > API Controls**
3. Click **Manage Domain Wide Delegation**
4. Click **Add new**
5. Enter Client ID from service account JSON key
6. Add OAuth Scopes:
   ```
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/drive.file
   ```
7. Authorize

### 4. Create Shared Calendar

1. Open Google Calendar
2. Click **+** next to "Other calendars"
3. Select **Create new calendar**
4. Name: "HOI Worksites"
5. Description: "Automated time tracking calendar for HOI worksites"
6. Click **Create calendar**
7. In calendar settings:
   - Share with service account email (from JSON key)
   - Permission: **Make changes to events**
   - Copy the Calendar ID (looks like: `abc123@group.calendar.google.com`)

### 5. Create Drive Folder

1. Open Google Drive
2. Create folder: "HOI Time Clock Reports"
3. Share with service account email
4. Permission: **Editor**
5. Copy folder ID from URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`

## Phase 4: Environment Configuration (15 minutes)

### 1. Frontend Environment Variables

Create `.env.local`:

```env
# Firebase Configuration (from Firebase Console)
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=hoi-time-clock.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=hoi-time-clock
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=hoi-time-clock.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# HOI Configuration
NEXT_PUBLIC_HOI_WORKSPACE_DOMAIN=housingopportunities.org
NEXT_PUBLIC_ED_EMAIL=director@housingopportunities.org

# Google Calendar Configuration
NEXT_PUBLIC_CALENDAR_ID=your_calendar_id@group.calendar.google.com
```

### 2. Functions Environment Variables

Create `functions/.env`:

```env
CALENDAR_ID=your_calendar_id@group.calendar.google.com
SERVICE_ACCOUNT_EMAIL=hoi-time-clock-service@hoi-time-clock.iam.gserviceaccount.com
DRIVE_FOLDER_ID=your_drive_folder_id
```

## Phase 5: Deploy Infrastructure (30 minutes)

### 1. Deploy Firestore Rules and Indexes

```bash
# Deploy database rules
firebase deploy --only firestore:rules

# Deploy indexes (this may take 5-10 minutes)
firebase deploy --only firestore:indexes

# Check index build status
# Go to Firebase Console > Firestore > Indexes
# Wait until all indexes show "Enabled" status
```

### 2. Deploy Cloud Functions

```bash
# Navigate to functions directory
cd functions

# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy functions
cd ..
firebase deploy --only functions

# This deploys:
# - onSiteDayCreated (Firestore trigger)
# - onSiteDayEnded (Firestore trigger)
# - batchSyncCalendarEvents (Scheduled, every 5 min)
# - syncCalendarEvent (HTTP callable)
```

### 3. Build and Deploy Frontend

```bash
# Install frontend dependencies
npm install

# Build Next.js for static export
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting

# Your app will be live at:
# https://hoi-time-clock.web.app
# https://hoi-time-clock.firebaseapp.com
```

## Phase 6: Initial Data Setup (15 minutes)

### 1. Create Executive Director Account

1. Open the deployed app: `https://hoi-time-clock.web.app`
2. Sign in with ED's Google Workspace account
3. Note the Firebase Auth UID (check Firebase Console > Authentication)

### 2. Manually Create ED User Document

In Firebase Console > Firestore:

1. Click "Start collection": `users`
2. Document ID: `[paste ED's Firebase Auth UID]`
3. Add fields:

```javascript
{
  googleSubject: "[ED's Firebase Auth UID]",
  email: "director@housingopportunities.org",
  displayName: "Executive Director Name",
  role: "ED",
  active: true,
  managerWorksites: [],  // Empty array
  createdAt: [Timestamp: now]
}
```

### 3. Test ED Access

1. Sign out and sign back in
2. Verify ED role badge appears
3. Verify all menu items visible (Dashboard, Worksites, Reports, Admin)

## Phase 7: Create Initial Worksites and Users (30 minutes)

### Using the Admin Panel (ED Only)

1. **Create Worksites**
   - Go to Worksites tab
   - Click "New Worksite"
   - Enter:
     - Name: "123 Main Street Renovation"
     - Address: "123 Main St, Pittsburgh, PA 15213"
     - Active: Yes
   - Click Save

2. **Create Program Director Accounts**
   - Go to Admin tab
   - Click "New User"
   - Sign in PD with their Google Workspace account first
   - Then in Firestore, update their role to "PD"
   - Add worksite IDs to their `managerWorksites` array
   - Update worksite's `managers` array with PD's user ID

3. **Create Technician/Operator Accounts**
   - Users can self-register by signing in
   - They default to "TO" role
   - No additional configuration needed

## Phase 8: Testing the Complete Workflow (20 minutes)

### Test Case: Complete Worksite Day

1. **As Program Director**
   ```
   - Sign in with PD account
   - Go to Dashboard
   - Select a worksite
   - Click "Start Day"
   - Verify:
     ✓ SiteDay created in Firestore (status: OPEN)
     ✓ Calendar event created in "HOI Worksites" calendar
     ✓ Event title: "Worksite Name — 2026-01-27"
     ✓ Event description contains HOI TIME CLOCK header
   ```

2. **As Technician (First Worker)**
   ```
   - Sign in with TO account
   - Go to Dashboard
   - See open worksite day
   - Click "Clock In"
   - Verify:
     ✓ Punch record created (type: IN)
     ✓ UI shows "Clocked In" status
   ```

3. **As Technician (Second Worker)**
   ```
   - Sign in with different TO account
   - Clock in to same worksite
   - Work for a while
   - Clock out
   - Verify shift calculation
   ```

4. **Wait 5 Minutes**
   ```
   - Check Google Calendar event
   - Verify CREW LOG updated with punch times
   - Format: "2:30 PM IN — John Doe"
   ```

5. **As Program Director (End Day)**
   ```
   - Click "End Day"
   - Verify:
     ✓ All open shifts force-closed
     ✓ SiteDay status: CLOSED
     ✓ Calendar event updated with:
       - END-OF-DAY SUMMARY section
       - Each worker's total hours
       - SITE TOTAL hours
       - "Closed By" information
     ✓ No further punches allowed for this siteDay
   ```

## Phase 9: Generate First Report (ED Only, 10 minutes)

1. Go to Reports tab
2. Select "Totals by Person"
3. Date range: Today
4. Click "Generate Report"
5. Verify on-screen table displays
6. Click "Download CSV"
7. Test "Save to Drive" (check Drive folder)
8. Test "Share with Program Director"

## Monitoring and Maintenance

### Daily Checks

```bash
# View Cloud Functions logs
firebase functions:log

# Check specific function
firebase functions:log --only batchSyncCalendarEvents

# Monitor authentication
# Firebase Console > Authentication > Users
```

### Weekly Tasks

1. Review audit logs (Firestore > auditLogs collection)
2. Check Calendar API quota usage (Cloud Console > APIs & Services > Quotas)
3. Verify all scheduled functions running (Cloud Scheduler)

### Monthly Tasks

1. Export reports for payroll
2. Archive old site days (implement data retention policy)
3. Review user accounts (deactivate terminated employees)
4. Backup Firestore data

## Troubleshooting Guide

### Issue: Calendar Events Not Creating

**Symptoms**: SiteDay created but no Calendar event

**Checks**:
```bash
# 1. Verify Cloud Function deployed
firebase functions:list

# 2. Check function logs
firebase functions:log --only onSiteDayCreated

# 3. Verify Calendar ID in environment
# Check functions/.env has correct CALENDAR_ID
```

**Solutions**:
- Redeploy functions: `firebase deploy --only functions`
- Verify service account has calendar access
- Check Calendar API enabled in Cloud Console

### Issue: Users Can't Sign In

**Symptoms**: "Access denied" or authentication fails

**Checks**:
- User email domain matches HOI workspace
- Firebase Auth has Google provider enabled
- Authorized domains include your workspace

**Solutions**:
- Add user's domain to authorized domains
- Verify Google sign-in provider configuration
- Check browser console for specific errors

### Issue: Punches Not Syncing to Calendar

**Symptoms**: Calendar event not updating with crew log

**Checks**:
```bash
# Check scheduled function
firebase functions:log --only batchSyncCalendarEvents
```

**Solutions**:
- Verify Cloud Scheduler created (happens automatically)
- Check `lastCalendarSyncAt` field in siteDays
- Manually trigger sync via `syncCalendarEvent` function

### Issue: ED Can't Generate Reports

**Symptoms**: Error when clicking "Generate Report"

**Checks**:
- ED role correctly set in Firestore
- Firestore rules allow report creation
- Date range has data

**Solutions**:
- Verify user document has `role: "ED"`
- Check browser console for errors
- Ensure shifts exist for selected date range

## Security Considerations

### Data Access

- **Firebase Auth**: Only HOI workspace domain users
- **Firestore Rules**: Role-based access control
- **API Keys**: Service account for Calendar/Drive (server-side only)
- **Audit Logs**: All administrative actions logged

### Best Practices

1. **Rotate Service Account Keys**: Every 90 days
2. **Review Audit Logs**: Weekly for suspicious activity
3. **User Lifecycle**: Disable accounts immediately on termination
4. **API Quotas**: Monitor to prevent service disruptions

## Performance Optimization

### Current Limits

- **Calendar API**: 1M requests/day (more than sufficient)
- **Firestore**: 10K reads/writes per day on free tier
- **Cloud Functions**: 2M invocations/month on free tier

### Scaling Recommendations

- Current architecture supports up to 50 concurrent worksites
- For 100+ worksites, consider:
  - Firestore scaling (Blaze plan)
  - Calendar sync optimization (batch larger groups)
  - Report generation caching

## Backup and Recovery

### Automated Backups

```bash
# Enable Firestore automated exports
gcloud firestore export gs://hoi-time-clock-backups
```

### Manual Export

```bash
# Export all data
firebase firestore:export backup-$(date +%Y%m%d)

# Export specific collection
firebase firestore:export backup-siteDays --collection siteDays
```

## Cost Estimate (Monthly)

- **Firebase Hosting**: Free (< 10GB storage, < 360MB/day)
- **Firestore**: $0-5 (depends on reads/writes)
- **Cloud Functions**: $0-10 (free tier covers most usage)
- **Calendar/Drive APIs**: Free (well within quotas)

**Total**: $0-15/month for typical usage (5-10 active worksites/day)

## Support Resources

- **Firebase Documentation**: https://firebase.google.com/docs
- **Next.js Documentation**: https://nextjs.org/docs
- **Google Calendar API**: https://developers.google.com/calendar/api
- **Technical Issues**: Check Firebase Console > Support
- **Feature Requests**: Document in internal wiki

## Conclusion

You now have a fully functional HOI Time Clock system with:
- ✅ Google Workspace authentication
- ✅ Real-time time tracking
- ✅ Automated Calendar logging
- ✅ Role-based access control
- ✅ Comprehensive reporting
- ✅ Audit trail
- ✅ Mobile-first design

The system is production-ready and can scale with your organization's needs.

## Next Steps

1. Train Program Directors on Start/End Day workflow
2. Train Technicians on Clock In/Out process
3. Establish weekly ED report generation routine
4. Create SOPs for common tasks
5. Schedule monthly system reviews

---

**Document Version**: 1.0
**Last Updated**: January 2026
**Maintained By**: HOI IT Team
