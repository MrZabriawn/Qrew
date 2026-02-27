// src/lib/qbo/timeActivity.ts
// Constructs a QBO TimeActivity payload from Qrew shift data + mapping documents.
//
// Mapping resolution order:
//   1. Employee mapping   → shift.userId → organizations/{orgId}/qboEmployeeMappings/{userId}
//   2. Customer mapping   → siteDay.worksiteId → organizations/{orgId}/qboCustomerMappings/{worksiteId}
//   3. Class mapping      → optional programId → organizations/{orgId}/qboClassMappings/{programId}
//
// If the employee mapping is missing, we throw QboMappingError so the shift is marked
// `not_mapped` rather than failed — it requires human action to resolve, not a retry.
//
// If the customer mapping is missing, the TimeActivity is created without a CustomerRef.
// QBO allows this but the entry won't be linked to a job.

import { adminDb } from '@/lib/adminFirebase';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { TimeActivityPayload } from './client';
import type { Shift } from '@/types';
import { Timestamp } from 'firebase-admin/firestore';

// Timezone for all QBO time values — should match the org's payroll timezone
const PAYROLL_TZ = process.env.QBO_PAYROLL_TIMEZONE ?? 'America/New_York';

export class QboMappingError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'QboMappingError';
  }
}

export interface ShiftMappingContext {
  orgId:      string;
  worksiteId: string;   // from the SiteDay the shift belongs to
  programId?: string;   // optional class mapping
}

/**
 * Resolves all QBO mappings for a shift and constructs the TimeActivity payload.
 * Throws QboMappingError if the employee is not yet mapped (requires admin action).
 */
export async function buildTimeActivityPayload(
  shift: Shift,
  ctx: ShiftMappingContext
): Promise<TimeActivityPayload> {
  if (!shift.inAt || !shift.outAt) {
    throw new Error(`Shift ${shift.id} has no inAt/outAt — cannot build TimeActivity.`);
  }

  const orgRef = adminDb.collection('organizations').doc(ctx.orgId);

  // ── Employee / Vendor mapping ────────────────────────────────────────────
  const empSnap = await orgRef
    .collection('qboEmployeeMappings')
    .doc(shift.userId)
    .get();

  if (!empSnap.exists) {
    throw new QboMappingError(
      'employee',
      `User ${shift.userId} has no QBO employee/vendor mapping. ` +
      'Assign a mapping in Admin → QBO Mappings before approving this shift.'
    );
  }

  const empData   = empSnap.data()!;
  const entityId  = empData.qboEntityId as string;
  const entityType = empData.qboEntityType as 'Employee' | 'Vendor';
  const entityName = empData.qboDisplayName as string;

  // ── Customer (Worksite/Job) mapping ─────────────────────────────────────
  const custSnap = await orgRef
    .collection('qboCustomerMappings')
    .doc(ctx.worksiteId)
    .get();

  const customerRef = custSnap.exists
    ? {
        value: custSnap.data()!.qboCustomerId as string,
        name:  custSnap.data()!.qboDisplayName as string,
      }
    : undefined;

  // ── Class mapping (optional) ─────────────────────────────────────────────
  let classRef: { value: string; name: string } | undefined;
  if (ctx.programId) {
    const classSnap = await orgRef
      .collection('qboClassMappings')
      .doc(ctx.programId)
      .get();

    if (classSnap.exists) {
      classRef = {
        value: classSnap.data()!.qboClassId as string,
        name:  classSnap.data()!.qboDisplayName as string,
      };
    }
  }

  // ── Build payload ────────────────────────────────────────────────────────
  const inAt  = shift.inAt  instanceof Date ? shift.inAt  : (shift.inAt  as unknown as Timestamp).toDate();
  const outAt = shift.outAt instanceof Date ? shift.outAt : (shift.outAt as unknown as Timestamp).toDate();

  const txnDate  = format(inAt, 'yyyy-MM-dd');
  const startISO = formatInTimeZone(inAt,  PAYROLL_TZ, "yyyy-MM-dd'T'HH:mm:ssxxx");
  const endISO   = formatInTimeZone(outAt, PAYROLL_TZ, "yyyy-MM-dd'T'HH:mm:ssxxx");

  const durationMs  = outAt.getTime() - inAt.getTime();
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const payload: TimeActivityPayload = {
    TxnDate:        txnDate,
    NameOf:         entityType,
    BillableStatus: 'NotBillable',
    Taxable:        false,
    StartTime:      startISO,
    EndTime:        endISO,
    Hours:          hours,
    Minutes:        minutes,
    Description:    `Shift synced from Housing Workforce / Qrew (shift: ${shift.id})`,
  };

  if (entityType === 'Employee') {
    payload.EmployeeRef = { value: entityId, name: entityName };
  } else {
    payload.VendorRef = { value: entityId, name: entityName };
  }

  if (customerRef) payload.CustomerRef = customerRef;
  if (classRef)    payload.ClassRef    = classRef;

  return payload;
}
