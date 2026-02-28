// src/app/reports/page.tsx
// Report generation + payroll approval page — ED only.
// Reports tab: fetch shifts, compute totals, export CSV.
// Payroll tab: review completed shifts, approve for QBO push, push per-shift to QBO.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  Download, BarChart2, AlertCircle, CheckCircle,
  RefreshCw, Check,
} from 'lucide-react';
import {
  getShiftsByDateRange, getAllUsers, getAllWorksites,
  getSiteDaysByDateRange, createReportArtifact, approveShift,
} from '@/lib/db';
import type {
  ReportType, User, Worksite, SiteDay, Shift,
  ShiftApprovalStatus, QboSyncStatus,
} from '@/types';
import { formatDateTime, getLocalDateString, minutesToHHMM } from '@/lib/utils';
import { getRoleLabel } from '@/types';

type ReportRow = Record<string, string | number>;
type PageTab = 'reports' | 'payroll';

interface PayrollRow {
  shift:        Shift;
  workerName:   string;
  worksiteName: string;
  date:         string;
}

const ORG_ID = process.env.NEXT_PUBLIC_QBO_ORG_ID ?? '';

export default function ReportsPage() {
  const { user, firebaseUser, signOut, loading } = useAuth();
  const router = useRouter();

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [pageTab,  setPageTab]  = useState<PageTab>('reports');
  const [error,    setError]    = useState<string | null>(null);

  // ── Reports tab ─────────────────────────────────────────────────────────────
  const [startDate,      setStartDate]      = useState(() => {
    const d = new Date(); d.setDate(1); return getLocalDateString(d);
  });
  const [endDate,        setEndDate]        = useState(() => getLocalDateString(new Date()));
  const [reportType,     setReportType]     = useState<ReportType>('TOTALS_BY_PERSON');
  const [reportRows,     setReportRows]     = useState<ReportRow[]>([]);
  const [reportLoading,  setReportLoading]  = useState(false);
  const [generated,      setGenerated]      = useState(false);

  // ── Payroll tab ─────────────────────────────────────────────────────────────
  const [payStart,       setPayStart]       = useState(() => {
    const d = new Date(); d.setDate(1); return getLocalDateString(d);
  });
  const [payEnd,         setPayEnd]         = useState(() => getLocalDateString(new Date()));
  const [payrollRows,    setPayrollRows]    = useState<PayrollRow[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollLoaded,  setPayrollLoaded]  = useState(false);
  const [approvingId,    setApprovingId]    = useState<string | null>(null);
  const [pushingId,      setPushingId]      = useState<string | null>(null);
  const [pushResult,     setPushResult]     = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  // ── Reports tab logic ────────────────────────────────────────────────────────

  const generateReport = async () => {
    if (!user) return;
    setReportLoading(true);
    setError(null);
    setGenerated(false);
    try {
      const [shifts, allUsersList, allWorksitesList, siteDaysList] = await Promise.all([
        getShiftsByDateRange(startDate, endDate),
        getAllUsers(),
        getAllWorksites(false),
        getSiteDaysByDateRange(startDate, endDate),
      ]);

      const userMap     = new Map<string, User>(allUsersList.map(u => [u.id, u]));
      const worksiteMap = new Map<string, Worksite>(allWorksitesList.map(w => [w.id, w]));
      const siteDayMap  = new Map<string, SiteDay>(siteDaysList.map(sd => [sd.id, sd]));

      let rows: ReportRow[] = [];

      if (reportType === 'TOTALS_BY_PERSON') {
        const personMap = new Map<string, { name: string; role: string; totalMinutes: number; days: Set<string> }>();
        for (const shift of shifts) {
          if (!shift.durationMinutes) continue;
          const u  = userMap.get(shift.userId);
          const sd = siteDayMap.get(shift.siteDayId);
          const ex = personMap.get(shift.userId);
          if (!ex) {
            personMap.set(shift.userId, {
              name: u?.displayName ?? shift.userId,
              role: u ? getRoleLabel(u.role) : 'Unknown',
              totalMinutes: shift.durationMinutes,
              days: new Set(sd ? [sd.date] : []),
            });
          } else {
            ex.totalMinutes += shift.durationMinutes;
            if (sd) ex.days.add(sd.date);
          }
        }
        rows = Array.from(personMap.values())
          .sort((a, b) => b.totalMinutes - a.totalMinutes)
          .map(p => ({
            Name:              p.name,
            Role:              p.role,
            'Total Hours':     minutesToHHMM(p.totalMinutes),
            'Days Worked':     p.days.size,
            'Avg Daily Hours': minutesToHHMM(p.days.size > 0 ? Math.round(p.totalMinutes / p.days.size) : 0),
          }));

      } else if (reportType === 'TOTALS_BY_WORKSITE') {
        const siteMap = new Map<string, { name: string; address: string; totalMinutes: number; workers: Set<string>; days: Set<string> }>();
        for (const shift of shifts) {
          if (!shift.durationMinutes) continue;
          const sd = siteDayMap.get(shift.siteDayId);
          if (!sd) continue;
          const w  = worksiteMap.get(sd.worksiteId);
          const ex = siteMap.get(sd.worksiteId);
          if (!ex) {
            siteMap.set(sd.worksiteId, {
              name: w?.name ?? sd.worksiteId,
              address: w?.address ?? '',
              totalMinutes: shift.durationMinutes,
              workers: new Set([shift.userId]),
              days: new Set([sd.date]),
            });
          } else {
            ex.totalMinutes += shift.durationMinutes;
            ex.workers.add(shift.userId);
            ex.days.add(sd.date);
          }
        }
        rows = Array.from(siteMap.values())
          .sort((a, b) => b.totalMinutes - a.totalMinutes)
          .map(s => ({
            'Site Name':       s.name,
            Address:           s.address,
            'Total Hours':     minutesToHHMM(s.totalMinutes),
            'Unique Workers':  s.workers.size,
            'Days Active':     s.days.size,
          }));

      } else {
        rows = shifts
          .filter(s => s.outAt !== undefined)
          .map(s => {
            const sd = siteDayMap.get(s.siteDayId);
            const u  = userMap.get(s.userId);
            const w  = sd ? worksiteMap.get(sd.worksiteId) : undefined;
            return {
              Date:         sd?.date ?? '',
              Site:         w?.name ?? s.siteDayId,
              Worker:       u?.displayName ?? s.userId,
              Role:         u ? getRoleLabel(u.role) : 'Unknown',
              'Clock In':   formatDateTime(s.inAt),
              'Clock Out':  s.outAt ? formatDateTime(s.outAt) : '—',
              Duration:     s.durationMinutes !== undefined ? minutesToHHMM(s.durationMinutes) : '—',
              'Auto-closed': s.forcedOut ? 'Yes' : 'No',
            };
          })
          .sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
      }

      setReportRows(rows);
      setGenerated(true);

      await createReportArtifact({
        reportType,
        parametersJson: JSON.stringify({ startDate, endDate }),
        generatedAt:    new Date(),
        generatedBy:    user.id,
        fileType:       'csv',
        sharedWithEmails: [],
        sharedWithUserIds: [],
        access:         'private',
      });
    } catch (err) {
      console.error('Generate report error:', err);
      setError('Failed to generate report. Please try again.');
    } finally {
      setReportLoading(false);
    }
  };

  const exportCSV = () => {
    if (reportRows.length === 0) return;
    const headers    = Object.keys(reportRows[0]);
    const csvContent = [
      headers.join(','),
      ...reportRows.map(row =>
        headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `hoi-${reportType.toLowerCase().replace(/_/g, '-')}-${startDate}-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Payroll tab logic ────────────────────────────────────────────────────────

  const loadPayrollShifts = async () => {
    setPayrollLoading(true);
    setError(null);
    setPayrollLoaded(false);
    try {
      const [shifts, allUsersList, allWorksitesList, siteDaysList] = await Promise.all([
        getShiftsByDateRange(payStart, payEnd),
        getAllUsers(),
        getAllWorksites(false),
        getSiteDaysByDateRange(payStart, payEnd),
      ]);

      const userMap     = new Map<string, User>(allUsersList.map(u => [u.id, u]));
      const worksiteMap = new Map<string, Worksite>(allWorksitesList.map(w => [w.id, w]));
      const siteDayMap  = new Map<string, SiteDay>(siteDaysList.map(sd => [sd.id, sd]));

      const rows: PayrollRow[] = shifts
        .filter(s => s.outAt)                          // only completed shifts
        .filter(s => s.approvalStatus !== 'locked')    // locked shifts are immutable
        .map(s => {
          const sd = siteDayMap.get(s.siteDayId);
          const u  = userMap.get(s.userId);
          const w  = sd ? worksiteMap.get(sd.worksiteId) : undefined;
          return {
            shift:        s,
            workerName:   u?.displayName ?? s.userId,
            worksiteName: w?.name ?? s.siteDayId,
            date:         sd?.date ?? '',
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.workerName.localeCompare(b.workerName));

      setPayrollRows(rows);
      setPayrollLoaded(true);
    } catch (err) {
      console.error('Load payroll error:', err);
      setError('Failed to load shifts for payroll review.');
    } finally {
      setPayrollLoading(false);
    }
  };

  const handleApproveShift = async (shiftId: string) => {
    if (!user) return;
    setApprovingId(shiftId);
    try {
      await approveShift(shiftId, user.id);
      setPayrollRows(prev => prev.map(r =>
        r.shift.id === shiftId
          ? { ...r, shift: { ...r.shift, approvalStatus: 'approved' as ShiftApprovalStatus, approvedAt: new Date(), approvedBy: user.id } }
          : r
      ));
    } catch {
      setError('Failed to approve shift.');
    } finally {
      setApprovingId(null);
    }
  };

  const handleApproveAll = async () => {
    const pending = payrollRows.filter(r => !r.shift.approvalStatus || r.shift.approvalStatus === 'pending');
    for (const row of pending) {
      await handleApproveShift(row.shift.id);
    }
  };

  const handlePushShift = async (shiftId: string) => {
    if (!ORG_ID) { setError('NEXT_PUBLIC_QBO_ORG_ID is not configured.'); return; }
    if (!firebaseUser) return;
    setPushingId(shiftId);
    setPushResult(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/qbo/timeactivities/push', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ orgId: ORG_ID, shiftId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);

      setPayrollRows(prev => prev.map(r =>
        r.shift.id === shiftId
          ? { ...r, shift: { ...r.shift, syncStatus: 'synced' as QboSyncStatus } }
          : r
      ));
      setPushResult({ id: shiftId, ok: true, msg: 'Pushed to QBO.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPayrollRows(prev => prev.map(r =>
        r.shift.id === shiftId
          ? { ...r, shift: { ...r.shift, syncStatus: 'failed' as QboSyncStatus, syncError: msg } }
          : r
      ));
      setPushResult({ id: shiftId, ok: false, msg });
    } finally {
      setPushingId(null);
      setTimeout(() => setPushResult(null), 6000);
    }
  };

  // ── Status badge helpers ─────────────────────────────────────────────────────

  const approvalBadge = (s: Shift) => {
    if (s.approvalStatus === 'approved') return { label: 'Approved', cls: 'bg-green-100 text-green-700' };
    if (s.approvalStatus === 'locked')   return { label: 'Locked',   cls: 'bg-blue-100 text-blue-700' };
    return { label: 'Pending', cls: 'bg-gray-100 text-gray-500' };
  };

  const syncBadge = (s: Shift) => {
    if (!s.syncStatus || s.syncStatus === 'pending') return null;
    const map: Record<string, { label: string; cls: string }> = {
      synced:      { label: 'Synced',      cls: 'bg-green-100 text-green-700' },
      failed:      { label: 'Failed',      cls: 'bg-red-100 text-red-700' },
      not_mapped:  { label: 'Not mapped',  cls: 'bg-yellow-100 text-yellow-700' },
      retry:       { label: 'Retry',       cls: 'bg-orange-100 text-orange-700' },
      dead_letter: { label: 'Dead letter', cls: 'bg-red-200 text-red-800' },
    };
    return map[s.syncStatus] ?? null;
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const columns         = reportRows.length > 0 ? Object.keys(reportRows[0]) : [];
  const pendingCount    = payrollRows.filter(r => !r.shift.approvalStatus || r.shift.approvalStatus === 'pending').length;
  const approvedCount   = payrollRows.filter(r => r.shift.approvalStatus === 'approved').length;
  const syncedCount     = payrollRows.filter(r => r.shift.syncStatus === 'synced').length;

  return (
    <div className="min-h-screen bg-white max-w-md mx-auto">

      {/* Header */}
      <header className="border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white z-20">
        <div>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase font-mono" style={{ color: 'var(--accent)' }}>Qrew</p>
          <p className="text-[8px] text-gray-400 tracking-[0.4em] uppercase font-mono">Housing Workforce</p>
        </div>
        <button
          onClick={signOut}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="px-4 sm:px-6 py-6 pb-24">

        {/* Page title + tab bar */}
        <div className="border-b border-gray-100 pb-0 mb-6">
          <p className="field-label">Labor Data</p>
          <h2 className="text-lg font-bold text-gray-900 tracking-wide mt-1 mb-3">REPORTS</h2>
          <div className="flex gap-0 -mb-px">
            {(['reports', 'payroll'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPageTab(tab)}
                className="py-2.5 px-5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors"
                style={
                  pageTab === tab
                    ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                    : { borderColor: 'transparent', color: '#9ca3af' }
                }
              >
                {tab === 'reports' ? 'Reports' : (
                  <span className="flex items-center gap-1.5">
                    Payroll
                    {payrollLoaded && pendingCount > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                        {pendingCount}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Error banner (shared) */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Push result banner */}
        {pushResult && (
          <div className={`mb-6 p-3 rounded-2xl border text-sm flex items-center gap-2 ${
            pushResult.ok
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {pushResult.ok
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {pushResult.msg}
          </div>
        )}

        {/* ═══ REPORTS TAB ════════════════════════════════════════════════════ */}
        {pageTab === 'reports' && (
          <>
            <div className="card mb-8">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Generate Report</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date" className="input"
                    value={startDate} onChange={e => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date" className="input"
                    value={endDate} onChange={e => setEndDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
                  <select
                    className="input" value={reportType}
                    onChange={e => setReportType(e.target.value as ReportType)}
                  >
                    <option value="TOTALS_BY_PERSON">Hours by Person</option>
                    <option value="TOTALS_BY_WORKSITE">Hours by Worksite</option>
                    <option value="DETAILED_TIMESHEET">Detailed Timesheet</option>
                  </select>
                </div>
              </div>
              <button
                onClick={generateReport}
                disabled={reportLoading || !startDate || !endDate}
                className="btn btn-primary"
              >
                <BarChart2 className="w-4 h-4 mr-2" />
                {reportLoading ? 'Generating…' : 'Generate Report'}
              </button>
            </div>

            {reportLoading && (
              <div className="flex justify-center py-12"><div className="spinner" /></div>
            )}

            {generated && !reportLoading && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {reportType === 'TOTALS_BY_PERSON' ? 'Hours by Person'
                        : reportType === 'TOTALS_BY_WORKSITE' ? 'Hours by Worksite'
                        : 'Detailed Timesheet'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {startDate} to {endDate} · {reportRows.length} row{reportRows.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  {reportRows.length > 0 && (
                    <button onClick={exportCSV} className="btn btn-secondary text-sm">
                      <Download className="w-4 h-4 mr-2" />Export CSV
                    </button>
                  )}
                </div>

                {reportRows.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No data found for the selected range.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          {columns.map(col => (
                            <th key={col} className="text-left py-2 px-3 font-semibold text-gray-700 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reportRows.map((row, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${row['Auto-closed'] === 'Yes' ? 'bg-yellow-50' : ''}`}>
                            {columns.map(col => (
                              <td key={col} className="py-2 px-3 text-gray-800 whitespace-nowrap">
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ═══ PAYROLL TAB ════════════════════════════════════════════════════ */}
        {pageTab === 'payroll' && (
          <>
            {/* Date range + load */}
            <div className="card mb-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Payroll Period</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date" className="input"
                    value={payStart} onChange={e => setPayStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date" className="input"
                    value={payEnd} onChange={e => setPayEnd(e.target.value)}
                  />
                </div>
              </div>
              <button
                onClick={loadPayrollShifts}
                disabled={payrollLoading || !payStart || !payEnd}
                className="btn btn-primary"
              >
                <BarChart2 className="w-4 h-4 mr-2" />
                {payrollLoading ? 'Loading…' : 'Load Shifts'}
              </button>
            </div>

            {payrollLoading && (
              <div className="flex justify-center py-12"><div className="spinner" /></div>
            )}

            {payrollLoaded && !payrollLoading && (
              <>
                {/* Summary strip */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[
                    { label: 'Pending Review', count: pendingCount,  bg: 'bg-gray-50',   text: 'text-gray-700' },
                    { label: 'Approved',        count: approvedCount, bg: 'bg-green-50',  text: 'text-green-800' },
                    { label: 'Synced to QBO',   count: syncedCount,   bg: 'bg-blue-50',   text: 'text-blue-800' },
                  ].map(s => (
                    <div key={s.label} className={`rounded-2xl p-3 border border-gray-200 text-center ${s.bg}`}>
                      <p className={`text-xl font-bold ${s.text}`}>{s.count}</p>
                      <p className="text-[10px] font-mono text-gray-500 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {payrollRows.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No completed shifts found for this period.</p>
                  </div>
                ) : (
                  <>
                    {/* Bulk approve */}
                    {pendingCount > 0 && (
                      <div className="flex justify-end mb-4">
                        <button
                          onClick={handleApproveAll}
                          disabled={approvingId !== null}
                          className="btn btn-primary text-xs flex items-center gap-2 disabled:opacity-40"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve All Pending ({pendingCount})
                        </button>
                      </div>
                    )}

                    {/* Shift list */}
                    <div className="space-y-3">
                      {payrollRows.map(({ shift, workerName, worksiteName, date }) => {
                        const ab   = approvalBadge(shift);
                        const sb   = syncBadge(shift);
                        const isApproving = approvingId === shift.id;
                        const isPushing   = pushingId   === shift.id;
                        const canApprove  = !shift.approvalStatus || shift.approvalStatus === 'pending';
                        const canPush     = shift.approvalStatus === 'approved' && shift.syncStatus !== 'synced' && !!ORG_ID;

                        return (
                          <div key={shift.id} className="card p-4">
                            {/* Row header */}
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900 truncate">{workerName}</p>
                                <p className="text-xs text-gray-500 truncate">{worksiteName}</p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${ab.cls}`}>
                                  {ab.label}
                                </span>
                                {sb && (
                                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${sb.cls}`}>
                                    {sb.label}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Shift details */}
                            <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                              <div>
                                <p className="field-label">Date</p>
                                <p className="text-gray-800 font-mono">{date}</p>
                              </div>
                              <div>
                                <p className="field-label">Duration</p>
                                <p className="text-gray-800 font-mono">
                                  {shift.durationMinutes !== undefined
                                    ? minutesToHHMM(shift.durationMinutes)
                                    : '—'}
                                </p>
                              </div>
                              <div>
                                <p className="field-label">Clock In</p>
                                <p className="text-gray-800 font-mono text-[10px]">
                                  {shift.inAt ? formatDateTime(shift.inAt).split(' ')[1] : '—'}
                                </p>
                              </div>
                            </div>

                            {shift.syncError && (
                              <p className="text-[10px] text-red-600 font-mono mb-3 truncate" title={shift.syncError}>
                                Error: {shift.syncError}
                              </p>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2">
                              {canApprove && (
                                <button
                                  onClick={() => handleApproveShift(shift.id)}
                                  disabled={isApproving}
                                  className="btn btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
                                >
                                  {isApproving
                                    ? <RefreshCw className="w-3 h-3 animate-spin" />
                                    : <Check className="w-3 h-3" />}
                                  Approve
                                </button>
                              )}
                              {canPush && (
                                <button
                                  onClick={() => handlePushShift(shift.id)}
                                  disabled={isPushing}
                                  className="btn btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
                                >
                                  {isPushing
                                    ? <RefreshCw className="w-3 h-3 animate-spin" />
                                    : <RefreshCw className="w-3 h-3" />}
                                  Push to QBO
                                </button>
                              )}
                              {shift.syncStatus === 'synced' && (
                                <span className="text-xs text-green-700 flex items-center gap-1">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  In QBO
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {!payrollLoaded && !payrollLoading && (
              <div className="text-center py-16 text-gray-400">
                <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Select a date range and click Load Shifts.</p>
              </div>
            )}
          </>
        )}

      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 z-20 grid grid-cols-4">
        <button onClick={() => router.push('/dashboard')}
                className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
                style={{ color: '#9ca3af' }}>
          <Clock className="w-5 h-5" /><span className="text-[10px] font-medium">Home</span>
        </button>
        <button onClick={() => router.push('/worksites')}
                className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
                style={{ color: '#9ca3af' }}>
          <Building2 className="w-5 h-5" /><span className="text-[10px] font-medium">Sites</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
                style={{ color: 'var(--accent)' }}>
          <FileText className="w-5 h-5" /><span className="text-[10px] font-medium">Reports</span>
        </button>
        <button onClick={() => router.push('/admin')}
                className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
                style={{ color: '#9ca3af' }}>
          <Users className="w-5 h-5" /><span className="text-[10px] font-medium">Admin</span>
        </button>
      </nav>

    </div>
  );
}
