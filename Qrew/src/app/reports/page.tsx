// src/app/reports/page.tsx
// Report generation page — ED only.
// Fetches shift data from Firestore, computes totals client-side,
// displays results in a table, and allows CSV export.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  Download, BarChart2, AlertCircle,
} from 'lucide-react';
import {
  getShiftsByDateRange, getAllUsers, getAllWorksites,
  getSiteDaysByDateRange, createReportArtifact,
} from '@/lib/db';
import type { ReportType, User, Worksite, SiteDay } from '@/types';
import { formatDateTime, getLocalDateString, minutesToHHMM } from '@/lib/utils';
import { getRoleLabel } from '@/types';

// A report row is a plain string-keyed object for flexible table rendering
type ReportRow = Record<string, string | number>;

export default function ReportsPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // first of current month
    return getLocalDateString(d);
  });
  const [endDate, setEndDate] = useState(() => getLocalDateString(new Date()));
  const [reportType, setReportType] = useState<ReportType>('TOTALS_BY_PERSON');
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  const generateReport = async () => {
    if (!user) return;
    setReportLoading(true);
    setError(null);
    setGenerated(false);
    try {
      // Fetch all raw data in parallel
      const [shifts, allUsersList, allWorksitesList, siteDaysList] = await Promise.all([
        getShiftsByDateRange(startDate, endDate),
        getAllUsers(),
        getAllWorksites(false),
        getSiteDaysByDateRange(startDate, endDate),
      ]);

      const userMap = new Map<string, User>(allUsersList.map(u => [u.id, u]));
      const worksiteMap = new Map<string, Worksite>(allWorksitesList.map(w => [w.id, w]));
      const siteDayMap = new Map<string, SiteDay>(siteDaysList.map(sd => [sd.id, sd]));

      let rows: ReportRow[] = [];

      if (reportType === 'TOTALS_BY_PERSON') {
        // Aggregate minutes and unique days worked per person
        const personMap = new Map<string, {
          name: string;
          role: string;
          totalMinutes: number;
          days: Set<string>;
        }>();

        for (const shift of shifts) {
          if (!shift.durationMinutes) continue;
          const u = userMap.get(shift.userId);
          const sd = siteDayMap.get(shift.siteDayId);
          const existing = personMap.get(shift.userId);
          if (!existing) {
            personMap.set(shift.userId, {
              name: u?.displayName ?? shift.userId,
              role: u ? getRoleLabel(u.role) : 'Unknown',
              totalMinutes: shift.durationMinutes,
              days: new Set(sd ? [sd.date] : []),
            });
          } else {
            existing.totalMinutes += shift.durationMinutes;
            if (sd) existing.days.add(sd.date);
          }
        }

        rows = Array.from(personMap.values())
          .sort((a, b) => b.totalMinutes - a.totalMinutes)
          .map(p => ({
            Name: p.name,
            Role: p.role,
            'Total Hours': minutesToHHMM(p.totalMinutes),
            'Days Worked': p.days.size,
            'Avg Daily Hours': minutesToHHMM(p.days.size > 0 ? Math.round(p.totalMinutes / p.days.size) : 0),
          }));

      } else if (reportType === 'TOTALS_BY_WORKSITE') {
        // Aggregate minutes, unique workers, and active days per worksite
        const siteMap = new Map<string, {
          name: string;
          address: string;
          totalMinutes: number;
          workers: Set<string>;
          days: Set<string>;
        }>();

        for (const shift of shifts) {
          if (!shift.durationMinutes) continue;
          const sd = siteDayMap.get(shift.siteDayId);
          if (!sd) continue;
          const w = worksiteMap.get(sd.worksiteId);
          const existing = siteMap.get(sd.worksiteId);
          if (!existing) {
            siteMap.set(sd.worksiteId, {
              name: w?.name ?? sd.worksiteId,
              address: w?.address ?? '',
              totalMinutes: shift.durationMinutes,
              workers: new Set([shift.userId]),
              days: new Set([sd.date]),
            });
          } else {
            existing.totalMinutes += shift.durationMinutes;
            existing.workers.add(shift.userId);
            existing.days.add(sd.date);
          }
        }

        rows = Array.from(siteMap.values())
          .sort((a, b) => b.totalMinutes - a.totalMinutes)
          .map(s => ({
            'Site Name': s.name,
            Address: s.address,
            'Total Hours': minutesToHHMM(s.totalMinutes),
            'Unique Workers': s.workers.size,
            'Days Active': s.days.size,
          }));

      } else {
        // DETAILED_TIMESHEET — one row per completed shift
        rows = shifts
          .filter(shift => shift.outAt !== undefined)
          .map(shift => {
            const sd = siteDayMap.get(shift.siteDayId);
            const u = userMap.get(shift.userId);
            const w = sd ? worksiteMap.get(sd.worksiteId) : undefined;
            return {
              Date: sd?.date ?? '',
              Site: w?.name ?? shift.siteDayId,
              Worker: u?.displayName ?? shift.userId,
              Role: u ? getRoleLabel(u.role) : 'Unknown',
              'Clock In': formatDateTime(shift.inAt),
              'Clock Out': shift.outAt ? formatDateTime(shift.outAt) : '—',
              Duration: shift.durationMinutes !== undefined ? minutesToHHMM(shift.durationMinutes) : '—',
              'Auto-closed': shift.forcedOut ? 'Yes' : 'No',
            };
          })
          .sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
      }

      setReportRows(rows);
      setGenerated(true);

      // Save report artifact metadata to Firestore (no file storage in MVP)
      await createReportArtifact({
        reportType,
        parametersJson: JSON.stringify({ startDate, endDate }),
        generatedAt: new Date(),
        generatedBy: user.id,
        fileType: 'csv',
        sharedWithEmails: [],
        sharedWithUserIds: [],
        access: 'private',
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
    const headers = Object.keys(reportRows[0]);
    const csvContent = [
      headers.join(','),
      ...reportRows.map(row =>
        headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hoi-${reportType.toLowerCase().replace(/_/g, '-')}-${startDate}-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const columns = reportRows.length > 0 ? Object.keys(reportRows[0]) : [];

  return (
    <div className="min-h-screen bg-dark-base text-white">
      {/* Header */}
      <header className="border-b border-dark-border px-4 py-3 flex items-center justify-between sticky top-0 bg-dark-base z-20">
        <div>
          <p className="text-[9px] text-gray-600 tracking-[0.4em] uppercase font-mono">Elder Systems</p>
          <p className="text-[11px] font-bold text-white tracking-[0.2em] uppercase font-mono">Housing Workforce</p>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 text-[9px] tracking-[0.2em] uppercase text-gray-500
                     font-mono border border-dark-border2 px-3 py-1.5
                     hover:border-gray-500 hover:text-gray-300 transition-colors"
        >
          <LogOut className="w-3 h-3" />Sign Out
        </button>
      </header>

      <main className="px-4 sm:px-6 py-6 pb-20">
        <div className="border-b border-dark-border pb-4 mb-6">
          <p className="field-label">Labor Data</p>
          <h2 className="text-lg font-bold text-white tracking-wide mt-1">REPORTS</h2>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Report parameters card */}
        <div className="card mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate Report</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                className="input"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
              <select
                className="input"
                value={reportType}
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

        {/* Results */}
        {reportLoading && (
          <div className="flex justify-center py-12">
            <div className="spinner" />
          </div>
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
                <p className="text-gray-500 text-sm">
                  No data found for the selected date range and report type.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      {columns.map(col => (
                        <th
                          key={col}
                          className="text-left py-2 px-3 font-semibold text-gray-700 whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-gray-100 ${
                          row['Auto-closed'] === 'Yes' ? 'bg-yellow-50' : ''
                        }`}
                      >
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
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-dark-base border-t border-dark-border z-20 grid grid-cols-4">
        <button onClick={() => router.push('/dashboard')} className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-gray-700 hover:text-gray-400 transition-colors">
          <Clock className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Home</span>
        </button>
        <button onClick={() => router.push('/worksites')} className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-gray-700 hover:text-gray-400 transition-colors">
          <Building2 className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Sites</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-primary-500">
          <FileText className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Reports</span>
        </button>
        <button onClick={() => router.push('/admin')} className="flex flex-col items-center justify-center gap-1 py-3 text-gray-700 hover:text-gray-400 transition-colors">
          <Users className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Admin</span>
        </button>
      </nav>
    </div>
  );
}
