// src/lib/db.ts
// Firestore data access layer for the HOI Time Clock frontend.
// All reads and writes to the database go through the functions exported here.
// Firestore security rules (firestore.rules) enforce role-based access on the server;
// these functions rely on the authenticated user's token being present in requests.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  addDoc,
  deleteDoc,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  User,
  Worksite,
  SiteDay,
  Punch,
  Shift,
  AuditLog,
  ReportArtifact,
  UserRole,
  PunchType,
  PunchSource,
  SiteDayStatus,
} from '@/types';

// ----- COLLECTION NAME CONSTANTS -----
// Centralised so a typo in one place doesn't silently write to a different collection
const USERS = 'users';
const WORKSITES = 'worksites';
const SITEDAYS = 'siteDays';
const PUNCHES = 'punches';
const SHIFTS = 'shifts';
const AUDIT_LOGS = 'auditLogs';
const REPORTS = 'reportArtifacts';

// Converts Firestore Timestamp fields on a raw document object to JavaScript Date objects.
// Firestore returns Timestamp instances (not native Dates), so every document retrieved
// must be passed through this helper before it's typed as an application interface.
const convertTimestamps = (data: any) => {
  const converted = { ...data };
  Object.keys(converted).forEach((key) => {
    if (converted[key] instanceof Timestamp) {
      converted[key] = converted[key].toDate();
    }
  });
  return converted;
};

// ===== USER OPERATIONS =====

// Fetches a user document by their Firebase Auth UID.
// Returns null if the user hasn't been registered in Firestore yet.
export const getUser = async (userId: string): Promise<User | null> => {
  const docRef = doc(db, USERS, userId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? convertTimestamps({ id: docSnap.id, ...docSnap.data() }) as User : null;
};

// Looks up a user by email address.
// Used during first login to detect if the account was pre-created by an ED
// before the worker signed in for the first time.
export const getUserByEmail = async (email: string): Promise<User | null> => {
  const q = query(collection(db, USERS), where('email', '==', email), limit(1));
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : convertTimestamps({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() }) as User;
};

// Creates a new user document using the Firebase Auth UID as the document ID.
// The server timestamp is set here so createdAt is always authoritative.
export const createUser = async (userId: string, userData: Omit<User, 'id'>): Promise<void> => {
  await setDoc(doc(db, USERS, userId), {
    ...userData,
    createdAt: Timestamp.now(),
  });
};

// Partially updates a user document (e.g., changing role or toggling active status)
export const updateUser = async (userId: string, updates: Partial<User>): Promise<void> => {
  await updateDoc(doc(db, USERS, userId), updates);
};

// Returns all users; used by the ED admin panel to list and manage staff accounts
export const getAllUsers = async (): Promise<User[]> => {
  const snapshot = await getDocs(collection(db, USERS));
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as User);
};

// ===== WORKSITE OPERATIONS =====

// Fetches a single worksite by ID
export const getWorksite = async (worksiteId: string): Promise<Worksite | null> => {
  const docRef = doc(db, WORKSITES, worksiteId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? convertTimestamps({ id: docSnap.id, ...docSnap.data() }) as Worksite : null;
};

// Creates a new worksite and returns its auto-generated Firestore document ID
export const createWorksite = async (worksiteData: Omit<Worksite, 'id' | 'createdAt'>): Promise<string> => {
  const docRef = await addDoc(collection(db, WORKSITES), {
    ...worksiteData,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

// Partially updates worksite fields (e.g., name, address, active status, or managers list)
export const updateWorksite = async (worksiteId: string, updates: Partial<Worksite>): Promise<void> => {
  await updateDoc(doc(db, WORKSITES, worksiteId), updates);
};

// Returns all worksites, optionally filtering to only active ones.
// Workers see only active worksites; admins can pass activeOnly=false to see deactivated ones.
export const getAllWorksites = async (activeOnly: boolean = false): Promise<Worksite[]> => {
  const constraints: QueryConstraint[] = [];
  if (activeOnly) {
    constraints.push(where('active', '==', true));
  }
  const q = query(collection(db, WORKSITES), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as Worksite);
};

// Returns only the worksites where the given user ID is listed in the `managers` array.
// Used to scope the PD dashboard to sites they are responsible for.
export const getWorksitesByManager = async (userId: string): Promise<Worksite[]> => {
  const q = query(collection(db, WORKSITES), where('managers', 'array-contains', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as Worksite);
};

// ===== SITEDAY OPERATIONS =====

// Fetches a SiteDay by its document ID
export const getSiteDay = async (siteDayId: string): Promise<SiteDay | null> => {
  const docRef = doc(db, SITEDAYS, siteDayId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? convertTimestamps({ id: docSnap.id, ...docSnap.data() }) as SiteDay : null;
};

// Looks up a SiteDay by worksite ID + local date string (YYYY-MM-DD).
// Used to prevent a PD from accidentally starting a second day for the same site on the same date.
export const getSiteDayByWorksiteAndDate = async (
  worksiteId: string,
  date: string
): Promise<SiteDay | null> => {
  const q = query(
    collection(db, SITEDAYS),
    where('worksiteId', '==', worksiteId),
    where('date', '==', date),
    limit(1)
  );
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : convertTimestamps({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() }) as SiteDay;
};

// Creates a new SiteDay document (i.e., a PD is "starting the day" at a worksite).
// Date fields are explicitly converted to Firestore Timestamps before writing.
export const createSiteDay = async (siteDayData: Omit<SiteDay, 'id' | 'createdAt'>): Promise<string> => {
  const docRef = await addDoc(collection(db, SITEDAYS), {
    ...siteDayData,
    startedAt: Timestamp.fromDate(siteDayData.startedAt),
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

// Updates a SiteDay (e.g., closing it at end of day or recording a calendar sync timestamp).
// Date fields in the updates object are converted to Firestore Timestamps as needed.
export const updateSiteDay = async (siteDayId: string, updates: Partial<SiteDay>): Promise<void> => {
  const updateData: any = { ...updates };
  // Convert optional Date fields to Firestore Timestamps
  if (updates.endedAt) {
    updateData.endedAt = Timestamp.fromDate(updates.endedAt);
  }
  if (updates.lastCalendarSyncAt) {
    updateData.lastCalendarSyncAt = Timestamp.fromDate(updates.lastCalendarSyncAt);
  }
  await updateDoc(doc(db, SITEDAYS, siteDayId), updateData);
};

// Returns all currently open SiteDays across all worksites.
// Used on the dashboard to show workers which sites they can clock into.
export const getOpenSiteDays = async (): Promise<SiteDay[]> => {
  const q = query(collection(db, SITEDAYS), where('status', '==', 'OPEN'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as SiteDay);
};

// Returns all SiteDays within an inclusive date range, sorted newest first.
// Used as the first step in report generation (see getShiftsByDateRange).
export const getSiteDaysByDateRange = async (startDate: string, endDate: string): Promise<SiteDay[]> => {
  const q = query(
    collection(db, SITEDAYS),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as SiteDay);
};

// ===== PUNCH OPERATIONS =====

// Records a new clock-in or clock-out event for a worker.
// The timestamp is explicitly converted so it is stored as a Firestore Timestamp (not a string).
export const createPunch = async (punchData: Omit<Punch, 'id' | 'createdAt'>): Promise<string> => {
  const docRef = await addDoc(collection(db, PUNCHES), {
    ...punchData,
    timestamp: Timestamp.fromDate(punchData.timestamp),
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

// Returns all punches for a given SiteDay, ordered chronologically.
// Used when processing shifts and when building the Calendar event crew log.
export const getPunchesBySiteDay = async (siteDayId: string): Promise<Punch[]> => {
  const q = query(
    collection(db, PUNCHES),
    where('siteDayId', '==', siteDayId),
    orderBy('timestamp', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as Punch);
};

// Returns the most recent punches for a single user, newest first.
// The limitCount default of 50 is sufficient for a personal history view.
export const getPunchesByUser = async (userId: string, limitCount: number = 50): Promise<Punch[]> => {
  const q = query(
    collection(db, PUNCHES),
    where('userId', '==', userId),
    orderBy('timestamp', 'desc'),
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as Punch);
};

// Allows EDs/PDs to correct a punch (e.g., fix a wrong timestamp).
// The timestamp field is re-converted to a Firestore Timestamp if it was updated.
export const updatePunch = async (punchId: string, updates: Partial<Punch>): Promise<void> => {
  const updateData: any = { ...updates };
  if (updates.timestamp) {
    updateData.timestamp = Timestamp.fromDate(updates.timestamp);
  }
  await updateDoc(doc(db, PUNCHES, punchId), updateData);
};

// Hard-deletes a punch. Only EDs/PDs can call this (enforced by Firestore rules).
// Deletion should be logged in auditLogs before calling this function.
export const deletePunch = async (punchId: string): Promise<void> => {
  await deleteDoc(doc(db, PUNCHES, punchId));
};

// ===== SHIFT OPERATIONS =====

// Persists a calculated Shift record to Firestore.
// Shifts are derived from punches (see calculateShiftsFromPunches in utils.ts) and
// written here so they can be queried directly for reports without re-computing each time.
export const createShift = async (shiftData: Omit<Shift, 'id'>): Promise<string> => {
  const docRef = await addDoc(collection(db, SHIFTS), {
    ...shiftData,
    inAt: Timestamp.fromDate(shiftData.inAt),
    // outAt may be null for still-open shifts
    outAt: shiftData.outAt ? Timestamp.fromDate(shiftData.outAt) : null,
  });
  return docRef.id;
};

// Returns all shifts belonging to a specific SiteDay.
// Used when closing a day to calculate totals and when generating the Calendar summary.
export const getShiftsBySiteDay = async (siteDayId: string): Promise<Shift[]> => {
  const q = query(collection(db, SHIFTS), where('siteDayId', '==', siteDayId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as Shift);
};

// Returns all shifts that fall within a date range across all worksites.
// Because Shifts don't store a date field directly, we first resolve the SiteDay IDs
// for the range and then query shifts by those IDs.
// Firestore `in` queries are capped at 10 values, so we batch the IDs accordingly.
export const getShiftsByDateRange = async (startDate: string, endDate: string): Promise<Shift[]> => {
  // This requires joining with siteDays - simplified version
  const siteDays = await getSiteDaysByDateRange(startDate, endDate);
  const siteDayIds = siteDays.map((sd) => sd.id);

  // Firestore 'in' queries limited to 10 items, so batch if needed
  const batchSize = 10;
  const allShifts: Shift[] = [];

  for (let i = 0; i < siteDayIds.length; i += batchSize) {
    const batch = siteDayIds.slice(i, i + batchSize);
    const q = query(collection(db, SHIFTS), where('siteDayId', 'in', batch));
    const snapshot = await getDocs(q);
    allShifts.push(...snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as Shift));
  }

  return allShifts;
};

// ===== AUDIT LOG OPERATIONS =====

// Appends a new audit log entry. Should be called before any destructive operation
// (e.g., before deletePunch, before changing a user's role).
export const createAuditLog = async (logData: Omit<AuditLog, 'id' | 'createdAt'>): Promise<string> => {
  const docRef = await addDoc(collection(db, AUDIT_LOGS), {
    ...logData,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
};

// Queries audit logs with optional filters for entity type and/or entity ID.
// Results are sorted newest-first. Only the ED role can read these (enforced by Firestore rules).
// Note: combining entityType + entityId filters requires a composite index in firestore.indexes.json.
export const getAuditLogs = async (
  entityType?: string,
  entityId?: string,
  limitCount: number = 100
): Promise<AuditLog[]> => {
  // Always sort by newest first and apply the caller's result limit
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), limit(limitCount)];

  // Prepend equality filters (must come before inequality/sort clauses in Firestore queries)
  if (entityType) {
    constraints.unshift(where('entityType', '==', entityType));
  }
  if (entityId) {
    constraints.unshift(where('entityId', '==', entityId));
  }

  const q = query(collection(db, AUDIT_LOGS), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as AuditLog);
};

// ===== REPORT OPERATIONS =====

// Saves a new report artifact metadata document after the report file has been generated.
// The actual file bytes live in Firebase Storage or Google Drive; this record stores the links.
export const createReportArtifact = async (
  reportData: Omit<ReportArtifact, 'id'>
): Promise<string> => {
  const docRef = await addDoc(collection(db, REPORTS), {
    ...reportData,
    generatedAt: Timestamp.fromDate(reportData.generatedAt),
    // expiresAt is optional; store null instead of undefined so Firestore accepts the write
    expiresAt: reportData.expiresAt ? Timestamp.fromDate(reportData.expiresAt) : null,
  });
  return docRef.id;
};

// Fetches a single report artifact by ID; returns null if not found or access is denied
export const getReportArtifact = async (reportId: string): Promise<ReportArtifact | null> => {
  const docRef = doc(db, REPORTS, reportId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? convertTimestamps({ id: docSnap.id, ...docSnap.data() }) as ReportArtifact : null;
};

// Returns reports that have been explicitly shared with the given user.
// Uses the sharedWithUserIds array field for Firestore security rule compatibility.
export const getReportsForUser = async (userId: string): Promise<ReportArtifact[]> => {
  const q = query(
    collection(db, REPORTS),
    where('sharedWithUserIds', 'array-contains', userId),
    orderBy('generatedAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as ReportArtifact);
};

// Returns all reports generated by a given user (ED viewing their own report history)
export const getReportsByGenerator = async (userId: string): Promise<ReportArtifact[]> => {
  const q = query(
    collection(db, REPORTS),
    where('generatedBy', '==', userId),
    orderBy('generatedAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertTimestamps({ id: doc.id, ...doc.data() }) as ReportArtifact);
};

// Updates report metadata (e.g., adding the Drive URL after upload, or changing access level)
export const updateReportArtifact = async (
  reportId: string,
  updates: Partial<ReportArtifact>
): Promise<void> => {
  await updateDoc(doc(db, REPORTS, reportId), updates);
};
