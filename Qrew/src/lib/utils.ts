// src/lib/utils.ts
// Pure utility functions for the HOI Time Clock application.
// Contains date/time formatters, duration calculators, and the core punch-to-shift
// pairing algorithm used throughout the app.

import { format, formatDuration, intervalToDuration } from 'date-fns';
import type { Punch, Shift } from '@/types';

// Returns a time string in 12-hour format with am/pm (e.g., "9:30 am")
export const formatTime = (date: Date): string => {
  return format(date, 'h:mm a');
};

// Returns a short date string (e.g., "Jan 5, 2025")
export const formatDate = (date: Date): string => {
  return format(date, 'MMM d, yyyy');
};

// Returns a combined date + time string (e.g., "Jan 5, 2025 9:30 am")
export const formatDateTime = (date: Date): string => {
  return format(date, 'MMM d, yyyy h:mm a');
};

// Returns the local calendar date as a YYYY-MM-DD string (not UTC).
// Used when creating SiteDays to ensure the date reflects the worker's local timezone,
// not the server timezone.
export const getLocalDateString = (date: Date = new Date()): string => {
  return format(date, 'yyyy-MM-dd');
};

// Converts a raw minute count into an H:MM string (e.g., 90 → "1:30").
// Used in reports and Calendar event descriptions to display durations.
export const minutesToHHMM = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  // padStart ensures single-digit minutes are zero-padded (e.g., "1:05" not "1:5")
  return `${hours}:${mins.toString().padStart(2, '0')}`;
};

// Calculates the elapsed duration between two timestamps, rounded down to the nearest minute.
// Returns an integer number of minutes.
export const calculateDuration = (start: Date, end: Date): number => {
  return Math.floor((end.getTime() - start.getTime()) / 1000 / 60);
};

// Pairs IN and OUT punches for each worker into Shift records.
// This function implements the core time-tracking logic:
//   - Punches are grouped by userId, then sorted chronologically.
//   - Each IN punch opens a new shift; the next OUT punch closes it.
//   - If two consecutive INs appear (worker forgot to punch out), the first
//     shift is left open (forcedOut: false) — no automatic time is credited.
//   - Orphaned OUT punches (no preceding IN) are silently skipped.
//   - An unclosed shift at the end of the list is left open (no outAt/durationMinutes).
// Note: This version does NOT force-close shifts. Use forceCloseOpenShifts when ending a day.
export const calculateShiftsFromPunches = (punches: Punch[]): Shift[] => {
  const shifts: Shift[] = [];
  // Map from userId → sorted punch list, so each worker's punches are processed independently
  const userPunches = new Map<string, Punch[]>();

  // Group punches by user
  punches.forEach((punch) => {
    if (!userPunches.has(punch.userId)) {
      userPunches.set(punch.userId, []);
    }
    userPunches.get(punch.userId)!.push(punch);
  });

  // Process each user's punches.
  // for...of is used instead of forEach so TypeScript's control flow analysis (CFA)
  // can properly track mutations to `currentIn` across loop iterations.
  for (const [, userPunchList] of userPunches) {
    // Sort by timestamp ascending so we process punches in the order they occurred
    userPunchList.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    let currentIn: Punch | null = null;

    for (const punch of userPunchList) {
      if (punch.type === 'IN') {
        if (currentIn) {
          // Orphaned IN — a second clock-in before a clock-out.
          // Record the prior IN as an open shift (no outAt) without auto-closing it.
          shifts.push({
            id: `shift-${currentIn.id}`,
            siteDayId: currentIn.siteDayId,
            userId: currentIn.userId,
            inAt: currentIn.timestamp,
            outAt: undefined,
            durationMinutes: undefined,
            forcedOut: false,
          });
        }
        // Start tracking a new open shift
        currentIn = punch;
      } else if (punch.type === 'OUT') {
        if (currentIn) {
          // Normal case: close the current shift with this OUT punch
          const durationMinutes = calculateDuration(currentIn.timestamp, punch.timestamp);
          shifts.push({
            // ID encodes both punches so it's deterministic and human-readable
            id: `shift-${currentIn.id}-${punch.id}`,
            siteDayId: currentIn.siteDayId,
            userId: currentIn.userId,
            inAt: currentIn.timestamp,
            outAt: punch.timestamp,
            durationMinutes,
            forcedOut: false,
          });
          currentIn = null;
        }
        // else: orphaned OUT with no preceding IN — ignore it
      }
    }

    // Handle unclosed shift at end of punch list (worker is still clocked in)
    if (currentIn) {
      shifts.push({
        id: `shift-${currentIn.id}`,
        siteDayId: currentIn.siteDayId,
        userId: currentIn.userId,
        inAt: currentIn.timestamp,
        outAt: undefined,
        durationMinutes: undefined,
        forcedOut: false,
      });
    }
  }

  return shifts;
};

// Processes punches when a PD ends the workday.
// Works identically to calculateShiftsFromPunches but:
//   - Any shift that is still open at the time the day ends is force-closed
//     using endDayTimestamp as the OUT time (forcedOut: true).
//   - A synthetic OUT punch is generated for each force-closed shift so the
//     punch history reflects the auto-closure.
// Returns both the final shifts and any synthetic closing punches that need to be written.
export const forceCloseOpenShifts = (
  punches: Punch[],
  endDayTimestamp: Date
): { shifts: Shift[]; closingPunches: Omit<Punch, 'id' | 'createdAt'>[] } => {
  const shifts: Shift[] = [];
  // These synthetic OUT punches must be persisted so the punch log is complete
  const closingPunches: Omit<Punch, 'id' | 'createdAt'>[] = [];
  const userPunches = new Map<string, Punch[]>();

  // Group punches by user
  punches.forEach((punch) => {
    if (!userPunches.has(punch.userId)) {
      userPunches.set(punch.userId, []);
    }
    userPunches.get(punch.userId)!.push(punch);
  });

  // Process each user's punches.
  // for...of is used instead of forEach so TypeScript's CFA tracks `currentIn` correctly.
  for (const [, userPunchList] of userPunches) {
    userPunchList.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    let currentIn: Punch | null = null;

    for (const punch of userPunchList) {
      if (punch.type === 'IN') {
        if (currentIn) {
          // Second IN before an OUT — force-close the preceding open shift at end-of-day time
          const durationMinutes = calculateDuration(currentIn.timestamp, endDayTimestamp);
          shifts.push({
            id: `shift-${currentIn.id}`,
            siteDayId: currentIn.siteDayId,
            userId: currentIn.userId,
            inAt: currentIn.timestamp,
            outAt: endDayTimestamp,
            durationMinutes,
            forcedOut: true,
          });
        }
        currentIn = punch;
      } else if (punch.type === 'OUT') {
        if (currentIn) {
          // Normal clock-out; this shift closed naturally — not forced
          const durationMinutes = calculateDuration(currentIn.timestamp, punch.timestamp);
          shifts.push({
            id: `shift-${currentIn.id}-${punch.id}`,
            siteDayId: currentIn.siteDayId,
            userId: currentIn.userId,
            inAt: currentIn.timestamp,
            outAt: punch.timestamp,
            durationMinutes,
            forcedOut: false,
          });
          currentIn = null;
        }
      }
    }

    // Force close any remaining open shift at the end-of-day timestamp
    if (currentIn) {
      const durationMinutes = calculateDuration(currentIn.timestamp, endDayTimestamp);
      shifts.push({
        id: `shift-${currentIn.id}`,
        siteDayId: currentIn.siteDayId,
        userId: currentIn.userId,
        inAt: currentIn.timestamp,
        outAt: endDayTimestamp,
        durationMinutes,
        forcedOut: true,
      });

      // Create a synthetic OUT punch so the punch history is self-consistent.
      // Source is 'web' to indicate this was a system-generated punch, not a manual tap.
      closingPunches.push({
        siteDayId: currentIn.siteDayId,
        userId: currentIn.userId,
        type: 'OUT',
        timestamp: endDayTimestamp,
        source: 'web', // system-generated
      });
    }
  }

  return { shifts, closingPunches };
};

// Lightweight class-name utility: joins truthy string values with a space.
// Accepts strings, booleans (for conditional classes), or null/undefined (ignored).
// Example: cn('btn', isActive && 'btn-active', undefined) → 'btn btn-active'
export const cn = (...classes: (string | boolean | undefined | null)[]): string => {
  return classes.filter(Boolean).join(' ');
};
