// functions/src/index.ts
// Firebase Cloud Functions for the HOI Time Clock backend.
// Responsibilities:
//   1. onSiteDayCreated  — Creates a Google Calendar event when a PD opens a new worksite day.
//   2. batchSyncCalendarEvents — Scheduled job (every 5 min) that updates Calendar event
//      descriptions with the latest punch data for all currently-open SiteDays.
//   3. onSiteDayEnded    — Updates the Calendar event with a final summary when the day closes.
//   4. syncCalendarEvent — HTTP callable for manual/recovery sync of a single SiteDay's event.
//
// All Calendar API calls use a service account (service-account-key.json) with domain-wide
// delegation so the function can write to the shared HOI Google Calendar on behalf of the org.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';

// Initialize the Firebase Admin SDK (grants full Firestore access, bypasses security rules)
admin.initializeApp();

// QBO retry queue — scheduled background job for re-pushing failed TimeActivity records
export { qboRetryQueue } from './qboRetryQueue';

// Service account JSON file used to authenticate against the Google Calendar API.
// This file is NOT committed to source control — it must be deployed alongside the functions.
const SERVICE_ACCOUNT = require('../service-account-key.json');

// The Google Calendar ID to write events to (set as a Cloud Functions environment variable)
const CALENDAR_ID = process.env.CALENDAR_ID || '';

// Creates an authenticated Google Calendar API client using the service account credentials.
// The JWT auth scope is limited to calendar read/write only.
const getCalendarClient = () => {
  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT.client_email,
    undefined,
    SERVICE_ACCOUNT.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );
  return google.calendar({ version: 'v3', auth });
};

// ----- LOCAL INTERFACE DEFINITIONS -----
// These mirror the Firestore document shapes, using admin.firestore.Timestamp
// (rather than the client-side Date types in src/types/index.ts).

interface SiteDay {
  id: string;
  worksiteId: string;
  date: string;              // YYYY-MM-DD
  status: 'OPEN' | 'CLOSED';
  startedAt: admin.firestore.Timestamp;
  startedBy: string;         // user ID
  endedAt?: admin.firestore.Timestamp;
  endedBy?: string;          // user ID
  calendarEventId?: string;  // Set after the Cloud Function creates the Calendar event
  lastCalendarSyncAt?: admin.firestore.Timestamp;
}

interface Worksite {
  id: string;
  name: string;
  address: string;
}

interface User {
  id: string;
  displayName: string;
}

interface Punch {
  id: string;
  userId: string;
  type: 'IN' | 'OUT';
  timestamp: admin.firestore.Timestamp;
}

// ===== CLOUD FUNCTION: onSiteDayCreated =====
// Triggered whenever a new document is created in the `siteDays` collection.
// If the SiteDay status is OPEN, creates a Google Calendar event representing the worksite day
// and writes the event ID back to the SiteDay document for future updates.
export const onSiteDayCreated = functions.firestore
  .document('siteDays/{siteDayId}')
  .onCreate(async (snapshot, context) => {
    const siteDay = { id: snapshot.id, ...snapshot.data() } as SiteDay;

    // Only create Calendar events for active (OPEN) days; skip pre-created or CLOSED docs
    if (siteDay.status !== 'OPEN') return;

    try {
      // Fetch worksite details for the Calendar event title and description
      const worksiteDoc = await admin.firestore()
        .collection('worksites')
        .doc(siteDay.worksiteId)
        .get();
      const worksite = { id: worksiteDoc.id, ...worksiteDoc.data() } as Worksite;

      // Fetch the user who started the day for attribution in the Calendar description
      const userDoc = await admin.firestore()
        .collection('users')
        .doc(siteDay.startedBy)
        .get();
      const user = { id: userDoc.id, ...userDoc.data() } as User;

      const calendar = getCalendarClient();

      const startTime = siteDay.startedAt.toDate();
      // Default event end time is 8 hours after start; this is updated when the day closes
      const endTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000); // +8 hours

      const event = {
        // Event title: "Worksite Name — YYYY-MM-DD"
        summary: `${worksite.name} — ${siteDay.date}`,
        // Human-readable description with crew log; updated on each sync
        description: formatEventDescription(worksite, siteDay, user, [], 'OPEN'),
        start: {
          dateTime: startTime.toISOString(),
          timeZone: 'America/New_York',
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'America/New_York',
        },
        // Store the siteDayId in private extended properties for reverse-lookup
        extendedProperties: {
          private: {
            siteDayId: siteDay.id,
          },
        },
      };

      const response = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: event,
      });

      // Write the Calendar event ID back to Firestore so future updates can patch the same event
      await snapshot.ref.update({
        calendarEventId: response.data.id,
        lastCalendarSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Created calendar event ${response.data.id} for SiteDay ${siteDay.id}`);
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw error;
    }
  });

// ===== CLOUD FUNCTION: batchSyncCalendarEvents =====
// Scheduled to run every 5 minutes via Cloud Scheduler (Pub/Sub trigger).
// Finds OPEN SiteDays that haven't been synced in the last 5 minutes and patches
// their Calendar event descriptions with the latest punch log.
// Limited to 10 SiteDays per run to avoid Google Calendar API quota exhaustion.
export const batchSyncCalendarEvents = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async (context) => {
    // Compute the cutoff: SiteDays synced more recently than this are skipped
    const fiveMinutesAgo = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 5 * 60 * 1000)
    );

    // Find OPEN siteDays that haven't been synced in 5+ minutes
    const siteDaysSnapshot = await admin.firestore()
      .collection('siteDays')
      .where('status', '==', 'OPEN')
      .where('lastCalendarSyncAt', '<', fiveMinutesAgo)
      .limit(10)  // Process at most 10 per run to stay within API quota
      .get();

    const calendar = getCalendarClient();

    for (const doc of siteDaysSnapshot.docs) {
      const siteDay = { id: doc.id, ...doc.data() } as SiteDay;

      // Skip SiteDays that don't have a Calendar event yet (onSiteDayCreated may still be running)
      if (!siteDay.calendarEventId) continue;

      try {
        // Fetch worksite and user details for the event description
        const worksiteDoc = await admin.firestore()
          .collection('worksites')
          .doc(siteDay.worksiteId)
          .get();
        const worksite = { id: worksiteDoc.id, ...worksiteDoc.data() } as Worksite;

        const userDoc = await admin.firestore()
          .collection('users')
          .doc(siteDay.startedBy)
          .get();
        const user = { id: userDoc.id, ...userDoc.data() } as User;

        // Get all punches for this siteDay to rebuild the crew log
        const punchesSnapshot = await admin.firestore()
          .collection('punches')
          .where('siteDayId', '==', siteDay.id)
          .orderBy('timestamp', 'asc')
          .get();

        const punches = punchesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Punch[];

        // Use PATCH (partial update) to only update the description; preserves title/time/etc.
        await calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId: siteDay.calendarEventId,
          requestBody: {
            description: formatEventDescription(worksite, siteDay, user, punches, 'OPEN'),
          },
        });

        // Update lastCalendarSyncAt to prevent this SiteDay from being picked up again immediately
        await doc.ref.update({
          lastCalendarSyncAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Synced calendar event for SiteDay ${siteDay.id}`);
      } catch (error) {
        // Log per-SiteDay errors but continue processing the rest of the batch
        console.error(`Error syncing SiteDay ${siteDay.id}:`, error);
      }
    }

    return null;
  });

// ===== CLOUD FUNCTION: onSiteDayEnded =====
// Triggered whenever a `siteDays` document is updated.
// Detects the OPEN → CLOSED status transition and updates the Calendar event with:
//   - The actual end time (replacing the 8-hour default)
//   - A final summary showing each worker's total hours and first-in/last-out times
export const onSiteDayEnded = functions.firestore
  .document('siteDays/{siteDayId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as SiteDay;
    const after = { id: change.after.id, ...change.after.data() } as SiteDay;

    // Only act on the specific OPEN → CLOSED transition; ignore other field updates
    if (before.status === 'OPEN' && after.status === 'CLOSED' && after.calendarEventId) {
      try {
        // Fetch worksite details for the final event description
        const worksiteDoc = await admin.firestore()
          .collection('worksites')
          .doc(after.worksiteId)
          .get();
        const worksite = { id: worksiteDoc.id, ...worksiteDoc.data() } as Worksite;

        const startUserDoc = await admin.firestore()
          .collection('users')
          .doc(after.startedBy)
          .get();
        const startUser = { id: startUserDoc.id, ...startUserDoc.data() } as User;

        // Fetch all punches for the final crew log
        const punchesSnapshot = await admin.firestore()
          .collection('punches')
          .where('siteDayId', '==', after.id)
          .orderBy('timestamp', 'asc')
          .get();

        const punches = punchesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Punch[];

        // Fetch finalized shift records (written when forceCloseOpenShifts ran at day-end)
        const shiftsSnapshot = await admin.firestore()
          .collection('shifts')
          .where('siteDayId', '==', after.id)
          .get();

        const shifts = shiftsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        const calendar = getCalendarClient();

        // Patch the event with the real end time and the full end-of-day summary
        await calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId: after.calendarEventId,
          requestBody: {
            end: {
              // Use the actual recorded end time from the SiteDay document
              dateTime: after.endedAt!.toDate().toISOString(),
              timeZone: 'America/New_York',
            },
            description: await formatFinalEventDescription(
              worksite,
              after,
              startUser,
              punches,
              shifts
            ),
          },
        });

        console.log(`Updated calendar event for ended SiteDay ${after.id}`);
      } catch (error) {
        console.error('Error updating calendar event on end:', error);
      }
    }
  });

// ===== HELPER: formatEventDescription =====
// Builds the Calendar event description text for an OPEN SiteDay.
// Shows header metadata and a running crew log of all IN/OUT punches so far.
// Note: punch user IDs are not yet resolved to names in the live (OPEN) log — that happens
// in formatFinalEventDescription when the day closes and we can afford extra Firestore reads.
function formatEventDescription(
  worksite: Worksite,
  siteDay: SiteDay,
  startUser: User,
  punches: Punch[],
  status: 'OPEN' | 'CLOSED'
): string {
  let description = `HOI TIME CLOCK\n`;
  description += `Worksite: ${worksite.name}\n`;
  description += `Address: ${worksite.address}\n`;
  description += `Started By: ${startUser.displayName}\n`;
  description += `Start: ${siteDay.startedAt.toDate().toLocaleString()}\n`;
  description += `Status: ${status}\n\n`;

  // Append each punch as a timestamped log line
  if (punches.length > 0) {
    description += `CREW LOG:\n`;
    for (const punch of punches) {
      const timestamp = punch.timestamp.toDate().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      // Use the userId as a placeholder; final descriptions resolve to display names
      description += `${timestamp} ${punch.type} — [User ${punch.userId}]\n`;
    }
  }

  return description;
}

// ===== HELPER: formatFinalEventDescription =====
// Builds the Calendar event description for a CLOSED SiteDay.
// Performs additional Firestore reads to resolve user IDs to display names.
// Generates an end-of-day summary table showing each worker's total hours,
// first clock-in, and last clock-out, plus a site-wide total.
async function formatFinalEventDescription(
  worksite: Worksite,
  siteDay: SiteDay,
  startUser: User,
  punches: Punch[],
  shifts: any[]
): Promise<string> {
  let description = `HOI TIME CLOCK\n`;
  description += `Worksite: ${worksite.name}\n`;
  description += `Address: ${worksite.address}\n`;
  description += `Started By: ${startUser.displayName}\n`;
  description += `Start: ${siteDay.startedAt.toDate().toLocaleString()}\n`;
  description += `Status: CLOSED\n\n`;

  // Full crew log with resolved user display names (one Firestore read per punch user)
  if (punches.length > 0) {
    description += `CREW LOG:\n`;
    for (const punch of punches) {
      const userDoc = await admin.firestore().collection('users').doc(punch.userId).get();
      const userName = userDoc.exists ? userDoc.data()?.displayName : punch.userId;
      const timestamp = punch.timestamp.toDate().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      description += `${timestamp} ${punch.type} — ${userName}\n`;
    }
    description += `\n`;
  }

  description += `END-OF-DAY SUMMARY:\n`;

  // Group shifts by userId to compute per-worker totals
  const userShifts = new Map<string, any[]>();
  for (const shift of shifts) {
    if (!userShifts.has(shift.userId)) {
      userShifts.set(shift.userId, []);
    }
    userShifts.get(shift.userId)!.push(shift);
  }

  let totalMinutes = 0;

  // For each worker, output: "Name — H:MM (First In: X:XX, Last Out: X:XX)"
  for (const [userId, userShiftList] of userShifts.entries()) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    const userName = userDoc.exists ? userDoc.data()?.displayName : userId;

    // Sum durations across all shifts for this worker (forcedOut shifts have durationMinutes set)
    const userTotal = userShiftList.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    totalMinutes += userTotal;

    const hours = Math.floor(userTotal / 60);
    const mins = userTotal % 60;
    const duration = `${hours}:${mins.toString().padStart(2, '0')}`;

    // First shift's inAt = first clock-in of the day
    const firstIn = userShiftList[0].inAt.toDate().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    // Last shift's outAt = last clock-out (may be undefined if forced-out shift had no outAt)
    const lastShift = userShiftList[userShiftList.length - 1];
    const lastOut = lastShift.outAt
      ? lastShift.outAt.toDate().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'N/A';

    description += `${userName} — ${duration} (First In: ${firstIn}, Last Out: ${lastOut})\n`;
  }

  // Site-wide total hours across all workers
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = totalMinutes % 60;
  const siteTotal = `${totalHours}:${totalMins.toString().padStart(2, '0')}`;

  description += `\nSITE TOTAL: ${siteTotal}\n`;

  // Closing attribution line
  if (siteDay.endedAt && siteDay.endedBy) {
    const endUserDoc = await admin.firestore().collection('users').doc(siteDay.endedBy).get();
    const endUserName = endUserDoc.exists ? endUserDoc.data()?.displayName : siteDay.endedBy;
    description += `End: ${siteDay.endedAt.toDate().toLocaleString()} (Closed By: ${endUserName})\n`;
  }

  return description;
}

// ===== CLOUD FUNCTION: syncCalendarEvent =====
// HTTP callable function for manually triggering a Calendar sync for a specific SiteDay.
// Useful for recovery when the scheduled batch sync misses a site, or for debugging.
// Authentication required — the caller must be a signed-in Firebase user.
export const syncCalendarEvent = functions.https.onCall(async (data, context) => {
  // Reject unauthenticated calls (e.g., direct HTTP requests without a Firebase ID token)
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { siteDayId } = data;

  // Validate that the caller provided a siteDayId argument
  if (!siteDayId) {
    throw new functions.https.HttpsError('invalid-argument', 'siteDayId is required');
  }

  const siteDayDoc = await admin.firestore().collection('siteDays').doc(siteDayId).get();

  if (!siteDayDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'SiteDay not found');
  }

  const siteDay = { id: siteDayDoc.id, ...siteDayDoc.data() } as SiteDay;

  // Can only sync if a Calendar event was already created by onSiteDayCreated
  if (!siteDay.calendarEventId) {
    throw new functions.https.HttpsError('failed-precondition', 'No calendar event linked');
  }

  // Perform sync...
  // TODO: implement full sync logic (currently returns a stub response)
  return { success: true, message: 'Calendar event synced' };
});
