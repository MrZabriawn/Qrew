// src/lib/qbo/client.ts
// Typed QBO REST API client.
//
// Handles:
//   - Base URL selection (sandbox vs production)
//   - Bearer token injection
//   - JSON serialization / deserialization
//   - HTTP error surfacing with QBO fault details
//   - Rate limiting: Intuit enforces ~500 requests/minute per app.
//     This client does NOT implement automatic retry — that is the caller's responsibility
//     (see the retry queue in Firebase Functions). On 429 we throw QboRateLimitError so
//     the caller can decide whether to queue or propagate.
//
// All methods require a LiveConnection (obtained from tokenManager.getLiveConnection()).
// This keeps the client stateless and easy to test.

import type { LiveConnection } from './tokenManager';
import type { QboEmployee, QboCustomer, QboClass } from '@/types';

const BASE_URLS = {
  sandbox:    'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
} as const;

export class QboApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly qboFault: unknown,
    message: string
  ) {
    super(message);
    this.name = 'QboApiError';
  }
}

export class QboRateLimitError extends Error {
  constructor() {
    super('QBO API rate limit exceeded (429). Request queued for retry.');
    this.name = 'QboRateLimitError';
  }
}

// ─── Internal fetch wrapper ──────────────────────────────────────────────────

async function qboFetch(
  conn: LiveConnection,
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const base = BASE_URLS[conn.qboEnvironment];
  const url  = `${base}/v3/company/${conn.realmId}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${conn.accessToken}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 429) throw new QboRateLimitError();

  if (!res.ok) {
    let fault: unknown;
    try { fault = await res.json(); } catch { fault = null; }
    throw new QboApiError(res.status, fault, `QBO API error ${res.status} at ${path}`);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  return res.json();
}

// ─── Query helper (QBO uses SQL-like queries) ────────────────────────────────

async function query<T>(conn: LiveConnection, sql: string): Promise<T[]> {
  const encoded  = encodeURIComponent(sql);
  const response = await qboFetch(conn, `/query?query=${encoded}`) as {
    QueryResponse: Record<string, T[]>;
  };
  const key = Object.keys(response.QueryResponse)[0];
  return key ? (response.QueryResponse[key] ?? []) : [];
}

// ─── Employee & Vendor list ──────────────────────────────────────────────────

export async function listEmployees(conn: LiveConnection): Promise<QboEmployee[]> {
  // QBO paginates at 1000 rows; most orgs have < 1000 employees
  const rows = await query<{
    Id: string;
    DisplayName: string;
    Active: boolean;
  }>(conn, "SELECT Id, DisplayName, Active FROM Employee MAXRESULTS 1000");

  return rows.map((r) => ({
    id:          r.Id,
    displayName: r.DisplayName,
    active:      r.Active,
    type:        'Employee' as const,
  }));
}

export async function listVendors(conn: LiveConnection): Promise<QboEmployee[]> {
  // Vendors used as contractors appear as Worker1099 = true
  const rows = await query<{
    Id: string;
    DisplayName: string;
    Active: boolean;
  }>(conn, "SELECT Id, DisplayName, Active FROM Vendor WHERE Vendor1099 = true MAXRESULTS 1000");

  return rows.map((r) => ({
    id:          r.Id,
    displayName: r.DisplayName,
    active:      r.Active,
    type:        'Vendor' as const,
  }));
}

// ─── Customer (Job/Worksite) list ────────────────────────────────────────────

export async function listCustomers(conn: LiveConnection): Promise<QboCustomer[]> {
  const rows = await query<{
    Id: string;
    DisplayName: string;
    FullyQualifiedName: string;
    Active: boolean;
  }>(conn, "SELECT Id, DisplayName, FullyQualifiedName, Active FROM Customer MAXRESULTS 1000");

  return rows.map((r) => ({
    id:                  r.Id,
    displayName:         r.DisplayName,
    fullyQualifiedName:  r.FullyQualifiedName,
    active:              r.Active,
  }));
}

// ─── Class list ──────────────────────────────────────────────────────────────

export async function listClasses(conn: LiveConnection): Promise<QboClass[]> {
  const rows = await query<{
    Id: string;
    Name: string;
    FullyQualifiedName: string;
    Active: boolean;
  }>(conn, "SELECT Id, Name, FullyQualifiedName, Active FROM Class MAXRESULTS 1000");

  return rows.map((r) => ({
    id:                 r.Id,
    name:               r.Name,
    fullyQualifiedName: r.FullyQualifiedName,
    active:             r.Active,
  }));
}

// ─── TimeActivity CRUD ───────────────────────────────────────────────────────

export interface TimeActivityPayload {
  TxnDate:        string;          // YYYY-MM-DD
  NameOf:         'Employee' | 'Vendor';
  EmployeeRef?:   { value: string; name?: string };
  VendorRef?:     { value: string; name?: string };
  CustomerRef?:   { value: string; name?: string };
  ClassRef?:      { value: string; name?: string };
  ItemRef?:       { value: string; name?: string };
  BillableStatus: 'Billable' | 'NotBillable' | 'HasBeenBilled';
  Taxable:        boolean;
  StartTime:      string;          // ISO 8601 with offset
  EndTime:        string;
  Hours:          number;
  Minutes:        number;
  Description?:   string;
}

export interface TimeActivityResponse {
  TimeActivity: {
    Id:          string;
    SyncToken:   string;
    TxnDate:     string;
    Hours:       number;
    Minutes:     number;
  };
  time: string;
}

export async function createTimeActivity(
  conn: LiveConnection,
  payload: TimeActivityPayload
): Promise<TimeActivityResponse> {
  return qboFetch(conn, '/timeactivity', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<TimeActivityResponse>;
}

export async function updateTimeActivity(
  conn: LiveConnection,
  id: string,
  syncToken: string,
  payload: Partial<TimeActivityPayload>
): Promise<TimeActivityResponse> {
  // QBO full-replace update: POST to /timeactivity with Id + SyncToken in body
  return qboFetch(conn, '/timeactivity', {
    method: 'POST',
    body: JSON.stringify({ ...payload, Id: id, SyncToken: syncToken, sparse: false }),
  }) as Promise<TimeActivityResponse>;
}

export async function deleteTimeActivity(
  conn: LiveConnection,
  id: string,
  syncToken: string
): Promise<void> {
  await qboFetch(conn, '/timeactivity?operation=delete', {
    method: 'POST',
    body: JSON.stringify({ Id: id, SyncToken: syncToken }),
  });
}
