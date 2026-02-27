# HOI Time Clock - Quick Start Guide

## 🚀 5-Minute Local Development Setup

### Prerequisites
```bash
node --version  # 18.x or higher required
npm --version   # 9.x or higher required
```

### 1. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install functions dependencies
cd functions && npm install && cd ..
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local and add your Firebase configuration
# (Get from Firebase Console > Project Settings)
```

### 3. Run Development Server

```bash
# Start Next.js development server
npm run dev

# Open http://localhost:3000
```

## 📁 Project Structure

```
hoi-time-clock/
├── src/
│   ├── app/              # Next.js pages (App Router)
│   │   ├── page.tsx      # Landing/login page
│   │   ├── dashboard/    # Main dashboard
│   │   ├── worksites/    # Worksite management (ED/PD)
│   │   ├── reports/      # Report generation (ED only)
│   │   └── admin/        # User management (ED only)
│   ├── components/       # React components
│   │   ├── auth/         # Authentication wrapper
│   │   ├── clock/        # Clock in/out interface
│   │   └── ui/           # Reusable UI components
│   ├── lib/              # Utilities and services
│   │   ├── firebase.ts   # Firebase initialization
│   │   ├── db.ts         # Firestore operations
│   │   └── utils.ts      # Helper functions
│   └── types/            # TypeScript type definitions
├── functions/            # Cloud Functions
│   └── src/
│       └── index.ts      # Calendar sync functions
├── public/               # Static assets
└── [config files]        # Various configuration files
```

## 🔑 Key Concepts

### User Roles

1. **Executive Director (ED)**
   - Full system access
   - User management
   - Report generation
   - All administrative functions

2. **Program Director (PD)**
   - Worksite management
   - Start/End worksite days
   - Time corrections (with audit log)
   - View shared reports

3. **Technician/Operator (TO)**
   - Clock in/out only
   - View personal time history
   - No administrative access

### Worksite Day Lifecycle

```
1. PD clicks "Start Day" 
   ↓
2. Creates SiteDay (OPEN status)
   ↓
3. Cloud Function creates Calendar event
   ↓
4. TOs can clock in/out
   ↓
5. Batch sync updates Calendar every 5 min
   ↓
6. PD clicks "End Day"
   ↓
7. Forces close all shifts, calculates totals
   ↓
8. Updates Calendar with final summary
   ↓
9. SiteDay locked (CLOSED status)
```

### Data Flow

```
User Action → Firestore → Cloud Function → Google Calendar
     ↓
  Real-time UI Update (via Firestore listeners)
```

## 🛠️ Common Development Tasks

### Add a New Component

```bash
# Create component file
touch src/components/ui/MyComponent.tsx

# Import in page
import { MyComponent } from '@/components/ui/MyComponent';
```

### Add a New Page

```bash
# Create route folder
mkdir -p src/app/my-route

# Create page
touch src/app/my-route/page.tsx
```

### Add Firestore Operation

```typescript
// In src/lib/db.ts
export const getMyData = async (id: string): Promise<MyType | null> => {
  const docRef = doc(db, 'myCollection', id);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() 
    ? convertTimestamps({ id: docSnap.id, ...docSnap.data() }) as MyType 
    : null;
};
```

### Test Cloud Function Locally

```bash
# Start Firebase emulators
firebase emulators:start

# Emulators run at:
# - Firestore: http://localhost:8080
# - Functions: http://localhost:5001
```

## 🐛 Debugging

### Frontend Issues

```bash
# Check browser console
# Open DevTools → Console

# Check Next.js build errors
npm run build
```

### Backend Issues

```bash
# View Cloud Functions logs
firebase functions:log

# View specific function
firebase functions:log --only functionName

# Real-time logs
firebase functions:log --follow
```

### Database Issues

```bash
# Check Firestore rules
firebase firestore:rules:get

# Test security rules
# Use Firebase Console > Firestore > Rules Playground
```

## 📦 Building for Production

```bash
# Build frontend
npm run build

# Build functions
cd functions && npm run build && cd ..

# Deploy everything
firebase deploy

# Deploy specific services
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## 🧪 Testing Checklist

### Before Each Deployment

- [ ] All TypeScript compiles without errors
- [ ] Firebase rules deployed and tested
- [ ] Environment variables set correctly
- [ ] Service account key in place (functions/)
- [ ] Calendar API integration tested
- [ ] At least one test worksite day completed
- [ ] All user roles tested (ED, PD, TO)
- [ ] Mobile responsiveness verified
- [ ] PWA manifest working

### Manual Test Flow

1. **Authentication**
   - Sign in with Google
   - Verify domain restriction
   - Check role assignment

2. **Worksite Management (PD/ED)**
   - Create new worksite
   - Assign managers
   - Start worksite day
   - Verify Calendar event created

3. **Time Tracking (TO)**
   - Clock in
   - Verify punch recorded
   - Clock out
   - Check duration calculation

4. **End Day (PD/ED)**
   - End worksite day
   - Verify all shifts closed
   - Check Calendar summary
   - Confirm day locked

5. **Reports (ED)**
   - Generate report
   - Download CSV
   - Save to Drive
   - Share with PD

## 🆘 Getting Help

### Documentation
- [Firebase Docs](https://firebase.google.com/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [Firestore Data Modeling](https://firebase.google.com/docs/firestore/data-model)
- [Calendar API Reference](https://developers.google.com/calendar/api/v3/reference)

### Common Errors

**"Firebase: Error (auth/popup-blocked)"**
- Solution: Enable popups in browser settings

**"Insufficient permissions"**
- Solution: Check Firestore security rules
- Verify user role in Firestore

**"Calendar event not created"**
- Solution: Check Cloud Functions logs
- Verify service account has calendar access

**"Failed to fetch"**
- Solution: Check Firebase project configuration
- Verify API keys in .env.local

## 💡 Development Tips

1. **Use Firebase Emulators** for faster development without affecting production
2. **Enable Firestore Debug Mode** to see real-time rule evaluations
3. **Use React DevTools** to inspect component state
4. **Monitor Network Tab** to debug API calls
5. **Check Firestore Console** to verify data structure
6. **Test on actual mobile device** for touch interactions
7. **Use TypeScript strictly** to catch errors early

## 🔄 Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "Add feature description"

# Push to remote
git push origin feature/my-feature

# Create pull request on GitHub
# After review, merge to main

# Deploy from main branch
git checkout main
git pull
npm run build
firebase deploy
```

## 📱 Mobile Development

### Test PWA Installation

1. Deploy to Firebase Hosting
2. Open on mobile device (HTTPS required)
3. Look for "Add to Home Screen" prompt
4. Install and test offline behavior

### Mobile-Specific Considerations

- Touch targets: Minimum 44x44px
- Viewport: Set correctly in layout.tsx
- Status bar: Theme color configured
- Offline: Service worker registered
- Performance: Lazy load images/components

## 🎨 Styling Guidelines

- Use Tailwind utility classes
- Follow mobile-first approach
- Maintain consistent spacing (4, 6, 8, 12, 16, 24)
- Use theme colors from tailwind.config.js
- Test in both light and dark mode (if implemented)

## 🚢 Ready to Deploy?

See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for complete production deployment instructions.

---

**Happy Coding! 🎉**
