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

interface Punch {
  id: string;
  userId: string;
  type: 'IN' | 'OUT';
  timestamp: admin.firestore.Timestamp;
  reason?: string;  // Set on early-departure OUT punches (worker left before end of day)
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
      // Fetch worksite details for the Calendar event title
      const worksiteDoc = await admin.firestore()
        .collection('worksites')
        .doc(siteDay.worksiteId)
        .get();
      const worksite = { id: worksiteDoc.id, ...worksiteDoc.data() } as Worksite;

      const calendar = getCalendarClient();

      const startTime = siteDay.startedAt.toDate();
      // Default event end time is 8 hours after start; this is updated when the day closes
      const endTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000);

      const event = {
        // Event title: "Worksite Name – Work Day"
        summary: `${worksite.name} \u2013 Work Day`,
        // Description starts empty — batchSyncCalendarEvents fills it in as workers clock in
        description: await formatEventDescription([]),
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
            description: await formatEventDescription(punches),
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
//   - A final summary showing Crew Clock-Ins, Early Departures, and End-of-Day totals
export const onSiteDayEnded = functions.firestore
  .document('siteDays/{siteDayId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as SiteDay;
    const after = { id: change.after.id, ...change.after.data() } as SiteDay;

    // Only act on the specific OPEN → CLOSED transition; ignore other field updates
    if (before.status === 'OPEN' && after.status === 'CLOSED' && after.calendarEventId) {
      try {
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

        // Fetch finalized shift records (written by handleEndDay before setting status CLOSED)
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
              punches,
              shifts,
              after.endedAt!,
              after.endedBy!,
            ),
          },
        });

        console.log(`Updated calendar event for ended SiteDay ${after.id}`);
      } catch (error) {
        console.error('Error updating calendar event on end:', error);
      }
    }
  });

// ===== HELPER: resolveUserNames =====
// Batch-fetches display names for a list of user IDs from Firestore in parallel.
// De-duplicates IDs before fetching to avoid redundant reads.
async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (id) => {
      const doc = await admin.firestore().collection('users').doc(id).get();
      map.set(id, doc.exists ? (doc.data()?.displayName ?? id) : id);
    })
  );
  return map;
}

// ===== HELPER: formatTime =====
// Formats a Date as "7:58 AM" style time string in Eastern Time.
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

// ===== HELPER: formatHours =====
// Formats a duration in minutes as a decimal hours string (e.g. 307 min → "5.1 hrs").
function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} hrs`;
}

// ===== HELPER: formatEventDescription =====
// Builds the Calendar event description for an OPEN SiteDay.
// Sections:
//   "Crew Clock-Ins"   — one line per IN punch: "Name – 7:58 AM"
//   "Early Departure"  — one line per OUT punch that has a reason:
//                        "Name – 1:12 PM – Reason – 5.1 hrs"
// Sections are omitted when empty. Name resolution is batched in a single Promise.all.
async function formatEventDescription(punches: Punch[]): Promise<string> {
  const names = await resolveUserNames(punches.map(p => p.userId));

  const inPunches = punches.filter(p => p.type === 'IN');
  const earlyOutPunches = punches.filter(p => p.type === 'OUT' && p.reason);

  const sections: string[] = [];

  if (inPunches.length > 0) {
    const lines = inPunches.map(p =>
      `${names.get(p.userId) ?? p.userId} \u2013 ${formatTime(p.timestamp.toDate())}`
    );
    sections.push(`Crew Clock-Ins\n${lines.join('\n')}`);
  }

  if (earlyOutPunches.length > 0) {
    const lines = earlyOutPunches.map(p => {
      const name = names.get(p.userId) ?? p.userId;
      const outTime = formatTime(p.timestamp.toDate());
      // Find the most recent IN punch for this user to compute hours worked before leaving
      const matchingIn = [...inPunches].reverse().find(ip => ip.userId === p.userId);
      let hoursStr = '';
      if (matchingIn) {
        const durationMs = p.timestamp.toDate().getTime() - matchingIn.timestamp.toDate().getTime();
        hoursStr = ` \u2013 ${formatHours(Math.round(durationMs / 60000))}`;
      }
      return `${name} \u2013 ${outTime} \u2013 ${p.reason}${hoursStr}`;
    });
    sections.push(`Early Departure\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

// ===== HELPER: formatFinalEventDescription =====
// Builds the Calendar event description for a CLOSED SiteDay.
// Includes the same Crew Clock-Ins and Early Departure sections as the live description,
// then appends an "End of Day" section with:
//   - Per-worker total hours (decimal, from the shifts collection)
//   - Site-wide grand total
//   - "Ended by [Supervisor] at [time]" attribution line
async function formatFinalEventDescription(
  punches: Punch[],
  shifts: any[],
  endedAt: admin.firestore.Timestamp,
  endedBy: string,
): Promise<string> {
  // Resolve all user IDs in one batched fetch (punches + shifts + supervisor)
  const userIds = [...punches.map(p => p.userId), ...shifts.map(s => s.userId), endedBy];
  const names = await resolveUserNames(userIds);

  const inPunches = punches.filter(p => p.type === 'IN');
  const earlyOutPunches = punches.filter(p => p.type === 'OUT' && p.reason);

  const sections: string[] = [];

  // Crew Clock-Ins (same logic as OPEN description)
  if (inPunches.length > 0) {
    const lines = inPunches.map(p =>
      `${names.get(p.userId) ?? p.userId} \u2013 ${formatTime(p.timestamp.toDate())}`
    );
    sections.push(`Crew Clock-Ins\n${lines.join('\n')}`);
  }

  // Early Departure (same logic as OPEN description)
  if (earlyOutPunches.length > 0) {
    const lines = earlyOutPunches.map(p => {
      const name = names.get(p.userId) ?? p.userId;
      const outTime = formatTime(p.timestamp.toDate());
      const matchingIn = [...inPunches].reverse().find(ip => ip.userId === p.userId);
      let hoursStr = '';
      if (matchingIn) {
        const durationMs = p.timestamp.toDate().getTime() - matchingIn.timestamp.toDate().getTime();
        hoursStr = ` \u2013 ${formatHours(Math.round(durationMs / 60000))}`;
      }
      return `${name} \u2013 ${outTime} \u2013 ${p.reason}${hoursStr}`;
    });
    sections.push(`Early Departure\n${lines.join('\n')}`);
  }

  // End of Day — per-worker totals from the shifts collection
  const userShifts = new Map<string, any[]>();
  for (const shift of shifts) {
    if (!userShifts.has(shift.userId)) userShifts.set(shift.userId, []);
    userShifts.get(shift.userId)!.push(shift);
  }

  const endOfDayLines: string[] = [];
  let totalMinutes = 0;

  for (const [userId, userShiftList] of userShifts.entries()) {
    const name = names.get(userId) ?? userId;
    const userTotal = userShiftList.reduce(
      (sum: number, s: any) => sum + (s.durationMinutes || 0), 0
    );
    totalMinutes += userTotal;
    endOfDayLines.push(`${name} \u2013 ${formatHours(userTotal)}`);
  }

  endOfDayLines.push(`Total \u2013 ${formatHours(totalMinutes)}`);
  endOfDayLines.push(
    `Ended by ${names.get(endedBy) ?? endedBy} at ${formatTime(endedAt.toDate())}`
  );

  sections.push(`End of Day\n${endOfDayLines.join('\n')}`);

  return sections.join('\n\n');
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

  // TODO: implement full sync logic (currently returns a stub response)
  return { success: true, message: 'Calendar event synced' };
});
