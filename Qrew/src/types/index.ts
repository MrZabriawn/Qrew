// src/types/index.ts
// Central TypeScript type definitions for the HOI Time Clock application.
// All shared interfaces, enums, and helper functions used across the frontend live here.

// ----- ROLE TYPES -----

// All possible user roles in the system.
// ED = Executive Director (highest access), PD = Program Director (site manager),
// TECH/COORD/TO = worker-level roles (lowest access — can only clock in/out)
export type UserRole = 'ED' | 'PD' | 'TO' | 'TECH' | 'COORD';

// Worker tier designation (Tier 3) - important for pay differentiation
// TECH = Technician, COORD = Coordinator, TO = Operator
export type WorkerTier = 'TECH' | 'COORD' | 'TO';

// User's preferred UI color accent — chosen once on first login, changeable in settings
export type AccentMode = 'blue' | 'green';

// ----- DATA MODELS -----

// Represents a HOI staff member stored in Firestore under /users/{uid}
export interface User {
  id: string;             // Firebase Auth UID (also the Firestore document ID)
  googleSubject: string;  // Google OAuth subject; same as Firebase UID for Google sign-in
  email: string;          // Google Workspace email (restricted to HOI domain)
  displayName: string;    // Full name from Google profile
  role: UserRole;
  workerTier?: WorkerTier; // Only set for worker roles (TECH, COORD, TO); undefined for ED/PD
  active: boolean;         // Soft-delete flag; inactive users can't log in
  managerWorksites: string[]; // worksite IDs this PD manages (empty for ED and workers)
  accentMode?: AccentMode; // undefined = not yet selected (first-login picker appears)
  createdAt: Date;
}

// Represents a physical worksite where HOI crews are deployed.
// Stored under /worksites/{worksiteId}
export interface Worksite {
  id: string;
  name: string;     // Human-readable site name (e.g., "123 Main St")
  address: string;  // Full street address; also appears in Google Calendar events
  active: boolean;  // Inactive worksites are hidden from workers
  managers: string[]; // user IDs of PDs assigned to manage this worksite
  lat?: number;     // Latitude — geocoded from address; required for clock-in geo-verification
  lng?: number;     // Longitude — geocoded from address; required for clock-in geo-verification
  createdAt: Date;
}

// Status of a SiteDay — OPEN means work is in progress; CLOSED means the day has ended
export type SiteDayStatus = 'OPEN' | 'CLOSED';

// Represents a single day of work at a worksite.
// A SiteDay is created when a PD "starts the day" and closed when they "end the day".
// Stored under /siteDays/{siteDayId}
export interface SiteDay {
  id: string;
  worksiteId: string;          // Foreign key → Worksite
  date: string;                // YYYY-MM-DD local date string (used for uniqueness per worksite)
  status: SiteDayStatus;
  startedAt: Date;             // Timestamp when the PD opened the site
  startedBy: string;           // user ID of the PD who started the day
  endedAt?: Date;              // Populated when status changes to CLOSED
  endedBy?: string;            // user ID of whoever ended the day
  calendarEventId?: string;    // Google Calendar event ID; set by Cloud Function after creation
  lastCalendarSyncAt?: Date;   // Tracks when the Calendar event was last updated (for batch sync)
  createdAt: Date;
}

// Whether a time punch represents clocking in or clocking out
export type PunchType = 'IN' | 'OUT';
// Where the punch originated (mobile app or web browser)
export type PunchSource = 'mobile' | 'web';

// Represents a single clock-in or clock-out event by a worker.
// Punches are the raw data; Shifts are derived by pairing IN/OUT punches.
// Stored under /punches/{punchId}
export interface Punch {
  id: string;
  siteDayId: string;  // Which SiteDay this punch belongs to
  userId: string;     // Worker who punched
  type: PunchType;    // 'IN' or 'OUT'
  timestamp: Date;    // When the punch occurred
  source: PunchSource;
  lat?: number;       // Worker's GPS latitude at time of punch (captured during geo-verification)
  lng?: number;       // Worker's GPS longitude at time of punch
  reason?: string;    // Early-departure reason (only on OUT punches where worker left before end of day)
  createdAt: Date;
}

// QBO sync status for a shift record
export type QboSyncStatus = 'pending' | 'synced' | 'failed' | 'retry' | 'dead_letter' | 'not_mapped';

// Approval status for a shift (gate for QBO push)
export type ShiftApprovalStatus = 'pending' | 'approved' | 'locked';

// A derived record representing a complete work period (IN punch paired with OUT punch).
// Shifts are calculated from Punches and stored for reporting.
// Stored under /shifts/{shiftId}
export interface Shift {
  id: string;           // Composite ID: "shift-{inPunchId}" or "shift-{inPunchId}-{outPunchId}"
  siteDayId: string;
  userId: string;
  inAt: Date;
  outAt?: Date;              // Undefined if the shift is still open or was never closed
  durationMinutes?: number;  // Calculated from (outAt - inAt); undefined for open shifts
  forcedOut: boolean;        // True if the OUT was automatically inserted when the day ended

  // QBO integration fields (optional — only set after QBO is connected)
  organizationId?: string;          // Org this shift belongs to (for multi-tenant QBO routing)
  approvalStatus?: ShiftApprovalStatus; // 'approved' triggers QBO push
  approvedAt?: Date;
  approvedBy?: string;              // userId of the payroll_admin who approved
  qboTimeActivityId?: string;       // TimeActivity.Id returned by QBO after successful push
  qboSyncToken?: string;            // QBO SyncToken (required for update/delete operations)
  syncStatus?: QboSyncStatus;
  syncError?: string;
  syncAttempts?: number;
  lastSyncAttempt?: Date;
  syncedAt?: Date;
}

// All possible audit log action types — used to track who did what to which entity
export type ActionType =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'WORKSITE_CREATED'
  | 'WORKSITE_UPDATED'
  | 'WORKSITE_DELETED'
  | 'SITEDAY_STARTED'
  | 'SITEDAY_ENDED'
  | 'PUNCH_CREATED'
  | 'PUNCH_EDITED'
  | 'PUNCH_DELETED'
  | 'REPORT_GENERATED'
  | 'REPORT_SHARED';

// The category of entity that was acted upon in an audit log entry
export type EntityType = 'USER' | 'WORKSITE' | 'SITEDAY' | 'PUNCH' | 'REPORT';

// Immutable record of an administrative action for compliance and debugging.
// Only EDs can read audit logs. Stored under /auditLogs/{logId}
export interface AuditLog {
  id: string;
  actorUserId: string;   // Who performed the action
  actionType: ActionType;
  entityType: EntityType;
  entityId: string;      // ID of the affected document
  beforeJson?: string;   // JSON snapshot of the document before the change
  afterJson?: string;    // JSON snapshot of the document after the change
  reason?: string;       // Optional justification (e.g., "correcting missed punch")
  createdAt: Date;
}

// The format of a generated report
export type ReportType =
  | 'TOTALS_BY_PERSON'      // Hours per worker over a date range
  | 'TOTALS_BY_WORKSITE'    // Hours per worksite over a date range
  | 'DETAILED_TIMESHEET';   // Row-by-row breakdown of all shifts

// Export file format for reports
export type FileType = 'csv' | 'pdf';
// Whether the report can be seen by others or just the generating ED
export type ReportAccess = 'private' | 'shared';

// Metadata for a generated report file stored in Firestore/Drive.
// Stored under /reportArtifacts/{reportId}
export interface ReportArtifact {
  id: string;
  reportType: ReportType;
  parametersJson: string;       // Serialized ReportParameters used to generate this report
  generatedAt: Date;
  generatedBy: string;          // user ID (must be ED)
  fileType: FileType;
  storageUrl?: string;          // Firebase Storage download URL (if stored there)
  driveFileId?: string;         // Google Drive file ID (if uploaded to Drive)
  driveWebViewLink?: string;    // Direct Google Drive URL for viewing in browser
  sharedWithEmails: string[];   // Email addresses this report was shared with
  sharedWithUserIds: string[];  // Corresponding user IDs (for Firestore security rules query)
  access: ReportAccess;
  expiresAt?: Date;             // Optional expiration for automatic cleanup
}

// Parameters passed when requesting a report generation
export interface ReportParameters {
  startDate: string;              // YYYY-MM-DD inclusive start date
  endDate: string;                // YYYY-MM-DD inclusive end date
  worksiteIds?: string[];         // If omitted, include all worksites
  programDirectorIds?: string[];  // Filter by managing PDs
  userIds?: string[];             // Filter by specific workers
}

// ----- UI STATE TYPES -----
// These types are used in React component state and are not persisted to Firestore.

// Summary statistics shown on the dashboard overview cards
export interface DashboardStats {
  activeWorksites: number;
  openSiteDays: number;
  activePunches: number;
  todayHours: number;
}

// Aggregated time totals per worker for the TOTALS_BY_PERSON report type
export interface PersonTotals {
  userId: string;
  userName: string;
  totalMinutes: number;
  daysWorked: number;
  averageDailyMinutes: number;
}

// Aggregated time totals per worksite for the TOTALS_BY_WORKSITE report type
export interface WorksiteTotals {
  worksiteId: string;
  worksiteName: string;
  totalMinutes: number;
  uniqueWorkers: number;
  dayCount: number;
}

// A single row in the DETAILED_TIMESHEET report — one row per completed shift
export interface DetailedTimesheetRow {
  date: string;
  worksiteName: string;
  userName: string;
  workerTier: WorkerTier;
  inTime: string;
  outTime: string;
  durationMinutes: number;
  forcedOut: boolean;  // Highlighted in the report if the worker's shift was auto-closed
}

// ----- HELPER FUNCTIONS -----

// Returns true if the role is a worker-level role (TECH, COORD, or TO)
// Use this to decide whether to show the clock-in/out UI vs. management views
export const isWorker = (role: UserRole): boolean => {
  return ['TECH', 'COORD', 'TO'].includes(role);
};

// Returns the human-readable label for a worker tier code
export const getWorkerTierLabel = (tier: WorkerTier): string => {
  const labels: Record<WorkerTier, string> = {
    TECH: 'Technician',
    COORD: 'Coordinator',
    TO: 'Operator'
  };
  return labels[tier];
};

// Returns the human-readable label for any user role code
export const getRoleLabel = (role: UserRole): string => {
  const labels: Record<UserRole, string> = {
    ED: 'Executive Director',
    PD: 'Program Director',
    TECH: 'Technician',
    COORD: 'Coordinator',
    TO: 'Operator'
  };
  return labels[role];
};

// ----- QBO INTEGRATION TYPES -----
// These types mirror Firestore documents in the organizations/{orgId} subcollection tree.
// They are used by server-side code only (API routes + Firebase Functions).

// Firestore: organizations/{orgId}
export interface Organization {
  id: string;
  name: string;           // e.g., "Housing Opportunities Inc."
  qrewInstance: string;   // Qrew product instance name, e.g., "Housing Workforce"
  domain: string;         // Google Workspace domain
  createdAt: Date;
}

// Connection status for a QBO OAuth session
export type QboConnectionStatus = 'active' | 'expired' | 'revoked' | 'disconnected';

// Firestore: organizations/{orgId}/qboConnection (document ID: "current")
// Access tokens are stored AES-256-GCM encrypted — never in plaintext.
export interface QboConnection {
  realmId: string;                  // QBO Company ID (from OAuth callback)
  encryptedAccessToken: string;     // AES-256-GCM ciphertext: iv:tag:data (hex-joined)
  encryptedRefreshToken: string;    // Same format
  tokenExpiry: Date;                // When the access token expires
  connectedAt: Date;
  connectedByUserId: string;
  status: QboConnectionStatus;
  qboEnvironment: 'sandbox' | 'production';
}

// Firestore: organizations/{orgId}/qboEmployeeMappings/{userId}
// Maps a Qrew user to their QuickBooks Employee or Vendor record.
export interface QboEmployeeMapping {
  userId: string;
  qboEntityId: string;              // QBO Employee.Id or Vendor.Id
  qboEntityType: 'Employee' | 'Vendor';
  qboDisplayName: string;
  mappedAt: Date;
  mappedByUserId: string;
}

// Firestore: organizations/{orgId}/qboCustomerMappings/{worksiteId}
// Maps a Qrew worksite to a QBO Customer (used as the "job" on time entries).
export interface QboCustomerMapping {
  worksiteId: string;
  qboCustomerId: string;
  qboDisplayName: string;
  mappedAt: Date;
  mappedByUserId: string;
}

// Firestore: organizations/{orgId}/qboClassMappings/{programId}
// Maps an internal program/classification to a QBO Class.
export interface QboClassMapping {
  programId: string;
  qboClassId: string;
  qboDisplayName: string;
  mappedAt: Date;
  mappedByUserId: string;
}

// Lightweight shapes returned by QBO list endpoints (used in mapping UI)
export interface QboEmployee {
  id: string;
  displayName: string;
  active: boolean;
  type: 'Employee' | 'Vendor';
}

export interface QboCustomer {
  id: string;
  displayName: string;
  active: boolean;
  fullyQualifiedName: string;
}

export interface QboClass {
  id: string;
  name: string;
  fullyQualifiedName: string;
  active: boolean;
}
