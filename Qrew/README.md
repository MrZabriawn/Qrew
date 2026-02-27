# HOI Time Clock

Internal time clock web application for Housing Opportunities Inc. (HOI) with Google Workspace integration, Calendar event logging, and role-based access control.

## Features

- **Role-Based Access Control**: Executive Director (ED), Program Director (PD), and Worker roles (Technician, Coordinator, Operator)
- **Worker Tier Differentiation**: Three worker tiers for pay distinction - Technician, Coordinator, and Operator
- **Worksite Day Management**: PDs start/end worksite days with automatic Google Calendar integration
- **Time Tracking**: Clock in/out functionality with real-time tracking
- **Google Calendar Integration**: Automatic event creation and batch updates
- **Audit Logging**: Complete audit trail for all administrative actions
- **Reports & Analytics**: ED-only report generation with Drive integration
- **Mobile-First Design**: Responsive PWA-ready interface

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend**: Firebase (Auth, Firestore, Cloud Functions)
- **APIs**: Google Calendar API, Google Drive API (for reports)
- **Deployment**: Firebase Hosting

## Prerequisites

1. Node.js 18+ and npm
2. Firebase CLI (`npm install -g firebase-tools`)
3. Google Cloud Project with Firebase enabled
4. Google Workspace domain for HOI

## Setup Instructions

### 1. Firebase Project Setup

```bash
# Login to Firebase
firebase login

# Initialize Firebase project
firebase init

# Select:
# - Firestore
# - Functions
# - Hosting
```

### 2. Google Cloud Console Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable APIs:
   - Google Calendar API
   - Google Drive API
3. Create Service Account:
   - Go to IAM & Admin > Service Accounts
   - Create service account with Calendar and Drive access
   - Download JSON key file
   - Save as `functions/service-account-key.json` (add to .gitignore)

4. Domain Delegation (for Calendar/Drive API):
   - Go to Google Workspace Admin Console
   - Security > API Controls > Domain-wide Delegation
   - Add service account with scopes:
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/drive.file`

### 3. Google Calendar Setup

1. Create a shared calendar named "HOI Worksites"
2. Share calendar with service account email (Make changes to events permission)
3. Get Calendar ID from calendar settings
4. Add to environment variables

### 4. Environment Configuration

Create `.env.local`:

```env
# Firebase Client Config
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# HOI Configuration
NEXT_PUBLIC_HOI_WORKSPACE_DOMAIN=housingopportunities.org
NEXT_PUBLIC_ED_EMAIL=director@housingopportunities.org

# Google Calendar
NEXT_PUBLIC_CALENDAR_ID=your_calendar_id@group.calendar.google.com
```

Create `functions/.env`:

```env
CALENDAR_ID=your_calendar_id@group.calendar.google.com
SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
DRIVE_FOLDER_ID=your_drive_folder_id
```

### 5. Firestore Security Rules

Deploy these rules to Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function getUser() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    function isED() {
      return isAuthenticated() && getUser().role == 'ED';
    }
    
    function isPD() {
      return isAuthenticated() && getUser().role == 'PD';
    }
    
    function isTO() {
      return isAuthenticated() && getUser().role == 'TO';
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create, update, delete: if isED();
    }
    
    // Worksites collection
    match /worksites/{worksiteId} {
      allow read: if isAuthenticated();
      allow create, update: if isED() || isPD();
      allow delete: if isED();
    }
    
    // SiteDays collection
    match /siteDays/{siteDayId} {
      allow read: if isAuthenticated();
      allow create, update: if isED() || isPD();
    }
    
    // Punches collection
    match /punches/{punchId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update, delete: if isED() || isPD();
    }
    
    // Shifts collection
    match /shifts/{shiftId} {
      allow read: if isAuthenticated();
      allow write: if isED() || isPD();
    }
    
    // Audit logs
    match /auditLogs/{logId} {
      allow read: if isED();
      allow create: if isAuthenticated();
    }
    
    // Reports
    match /reportArtifacts/{reportId} {
      allow read: if isED() || 
        get(/databases/$(database)/documents/reportArtifacts/$(reportId)).data.sharedWithUserIds.hasAny([request.auth.uid]);
      allow create, update: if isED();
    }
  }
}
```

### 6. Initial Data Seed

After first deployment, manually create ED user in Firestore:

```javascript
// In Firestore Console, create document in 'users' collection:
{
  id: "uid-from-firebase-auth",
  googleSubject: "google-subject-id",
  email: "director@housingopportunities.org",
  displayName: "Executive Director",
  role: "ED",
  active: true,
  managerWorksites: [],
  createdAt: <timestamp>
}
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

## Building Cloud Functions

```bash
cd functions
npm install
npm run build
```

## Deployment

```bash
# Build Next.js app
npm run build

# Deploy to Firebase
firebase deploy

# Or deploy individually:
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Application Structure

```
src/
├── app/              # Next.js app router pages
│   ├── dashboard/    # Dashboard views (ED/PD/TO)
│   ├── worksites/    # Worksite management
│   ├── reports/      # Report generation (ED only)
│   ├── admin/        # Admin panel (ED only)
│   └── layout.tsx    # Root layout
├── components/       # React components
│   ├── auth/         # Authentication components
│   ├── dashboard/    # Dashboard widgets
│   ├── clock/        # Clock in/out interface
│   ├── reports/      # Report viewers
│   └── ui/           # Reusable UI components
├── lib/              # Utilities and services
│   ├── firebase.ts   # Firebase initialization
│   ├── db.ts         # Firestore operations
│   ├── utils.ts      # Helper functions
│   └── api.ts        # API client functions
└── types/            # TypeScript definitions

functions/
└── src/
    ├── calendar.ts   # Calendar API integration
    ├── reports.ts    # Report generation
    ├── batch.ts      # Batch sync jobs
    └── index.ts      # Cloud Functions entry
```

## Usage Guide

### For Executive Directors (ED)

1. **User Management**: Create PD and TO accounts, assign roles
2. **Worksite Setup**: Create worksites and assign PD managers
3. **Reports**: Generate time reports, share with PDs, export to Drive
4. **Audit Trail**: View all system changes and corrections

### For Program Directors (PD)

1. **Start Day**: Begin a worksite day (creates Calendar event)
2. **Monitor**: Watch team clock in/out in real-time
3. **End Day**: Close worksite day (updates Calendar with summary)
4. **Corrections**: Edit punches with reason (logged in audit trail)
5. **View Reports**: Access reports shared by ED

### For Technicians/Operators (TO)

1. **Clock In**: Tap "Clock In" when arriving at open worksite
2. **Clock Out**: Tap "Clock Out" when leaving
3. **View History**: See personal time history

## Key Workflows

### Starting a Worksite Day

1. PD selects worksite and clicks "Start Day"
2. System creates SiteDay record (status: OPEN)
3. Cloud Function creates Google Calendar event
4. TOs can now clock in for this worksite-day

### Clocking In/Out

1. TO selects open worksite-day
2. Taps "Clock In" → creates IN punch in Firestore
3. Works at site
4. Taps "Clock Out" → creates OUT punch
5. Batch job queues Calendar update (every 5 min while OPEN)

### Ending a Worksite Day

1. PD clicks "End Day"
2. System:
   - Sets SiteDay status = CLOSED
   - Force-closes all open shifts at End Day timestamp
   - Calculates total hours per worker
   - Updates Calendar event with END-OF-DAY SUMMARY
   - Locks further edits (except ED/PD with audit reason)

### Report Generation (ED Only)

1. ED navigates to Reports
2. Selects report type and parameters
3. System generates from Firestore data
4. Options:
   - View on screen
   - Download CSV
   - Save to Google Drive
   - Share with specific PDs

## API Rate Limiting & Batch Updates

To avoid exceeding Calendar API quotas:

- Punches write immediately to Firestore (real-time for UI)
- Calendar updates are batched:
  - Maximum once per 5 minutes while SiteDay is OPEN
  - Final update on End Day with complete summary
- Cloud Function scheduled to run every 5 minutes checks for pending updates

## Security Considerations

1. **Authentication**: Google Workspace domain restriction
2. **Authorization**: Firestore security rules enforce role-based access
3. **Audit Trail**: All administrative actions logged
4. **Data Validation**: Server-side validation in Cloud Functions
5. **API Keys**: Service account for Calendar/Drive (not exposed to client)

## Monitoring & Maintenance

- **Firebase Console**: Monitor authentication, database, functions
- **Cloud Logging**: View function execution logs
- **Calendar Events**: Manual verification via Google Calendar
- **Audit Logs**: Regular review of administrative changes

## Troubleshooting

### Calendar events not creating
- Verify service account has calendar access
- Check Calendar ID is correct
- Review Cloud Functions logs

### Users can't sign in
- Verify workspace domain whitelist
- Check Firebase Auth settings
- Ensure user email matches domain

### Punches not syncing to Calendar
- Check batch sync function is running
- Verify SiteDay has calendarEventId
- Review function execution logs

## Support

For technical issues:
1. Check Firebase Console logs
2. Review audit logs for system events
3. Contact system administrator

## License

Internal use only - Housing Opportunities Inc.
