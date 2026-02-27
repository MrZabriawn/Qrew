// src/app/admin/audit/page.tsx
// Audit log viewer — ED only.
// Shows a chronological record of all system actions with before/after diffs.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  AlertCircle, ChevronDown, ChevronUp, Filter,
} from 'lucide-react';
import { getAuditLogs, getAllUsers } from '@/lib/db';
import type { AuditLog, User, EntityType } from '@/types';

function formatTs(date: Date): string {
  const now   = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1)   return 'just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  if (diffHr  < 24)  return `${diffHr}h ago`;
  if (diffDay <  7)  return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ACTION_COLOR: Record<string, string> = {
  USER_CREATED:      'text-green-400',
  USER_UPDATED:      'text-blue-400',
  USER_DELETED:      'text-red-400',
  WORKSITE_CREATED:  'text-green-400',
  WORKSITE_UPDATED:  'text-blue-400',
  WORKSITE_DELETED:  'text-red-400',
  SITEDAY_STARTED:   'text-green-400',
  SITEDAY_ENDED:     'text-orange-400',
  PUNCH_CREATED:     'text-accent-300',
  PUNCH_EDITED:      'text-blue-400',
  PUNCH_DELETED:     'text-red-400',
  REPORT_GENERATED:  'text-purple-400',
  REPORT_SHARED:     'text-purple-300',
};

export default function AuditPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();

  const [logs,        setLogs]        = useState<AuditLog[]>([]);
  const [userMap,     setUserMap]     = useState<Map<string, User>>(new Map());
  const [dataLoading, setDataLoading] = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [filter,      setFilter]      = useState<EntityType | ''>('');
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    setError(null);
    try {
      const [allLogs, allUsers] = await Promise.all([
        getAuditLogs(filter || undefined, undefined, 200),
        getAllUsers(),
      ]);
      setLogs(allLogs);
      const map = new Map<string, User>();
      allUsers.forEach(u => map.set(u.id, u));
      setUserMap(map);
    } catch (err) {
      console.error(err);
      setError('Failed to load audit logs.');
    } finally {
      setDataLoading(false);
    }
  }, [user, filter]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const entityTypes: EntityType[] = ['USER', 'WORKSITE', 'SITEDAY', 'PUNCH', 'REPORT'];

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

        {/* Title */}
        <div className="border-b border-dark-border pb-4 mb-6">
          <p className="field-label">Compliance</p>
          <h2 className="text-lg font-bold text-white tracking-wide mt-1">AUDIT LOG</h2>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
            All system actions — newest first
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* Filter bar */}
        <div className="mb-5 flex items-center gap-3">
          <Filter className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as EntityType | '')}
            className="input text-xs py-1.5 w-auto"
          >
            <option value="">All types</option>
            {entityTypes.map(et => (
              <option key={et} value={et}>{et}</option>
            ))}
          </select>
          {!dataLoading && (
            <span className="text-xs ml-auto font-mono" style={{ color: 'var(--text-muted)' }}>
              {logs.length} entries
            </span>
          )}
        </div>

        {/* Log list */}
        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="spinner" /></div>
        ) : logs.length === 0 ? (
          <div className="card text-center py-12">
            <FileText className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="font-medium text-white">No audit logs yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Actions are logged automatically as the system is used.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => {
              const actor    = userMap.get(log.actorUserId);
              const expanded = expandedId === log.id;
              const hasDiff  = !!(log.beforeJson || log.afterJson);
              const logDate  = log.createdAt instanceof Date
                ? log.createdAt
                : (log.createdAt as { toDate(): Date }).toDate();

              return (
                <div key={log.id} className="card p-3">
                  <div
                    className={`flex items-start justify-between gap-3 ${hasDiff ? 'cursor-pointer' : ''}`}
                    onClick={() => hasDiff && setExpandedId(expanded ? null : log.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-mono text-xs font-bold ${ACTION_COLOR[log.actionType] ?? 'text-gray-300'}`}>
                          {log.actionType}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {log.entityType} · {log.entityId.slice(0, 8)}…
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {actor ? actor.displayName : log.actorUserId.slice(0, 8)}
                        <span className="mx-1.5 text-gray-700">·</span>
                        {formatTs(logDate)}
                      </p>
                      {log.reason && (
                        <p className="text-xs mt-0.5 italic" style={{ color: 'var(--text-muted)' }}>
                          {log.reason}
                        </p>
                      )}
                    </div>
                    {hasDiff && (
                      <button className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    )}
                  </div>

                  {/* Expanded diff */}
                  {expanded && (
                    <div className="mt-3 border-t border-dark-border pt-3 space-y-2">
                      {log.beforeJson && (
                        <div>
                          <p className="field-label mb-1">Before</p>
                          <pre className="text-xs font-mono p-2 rounded overflow-x-auto text-red-400"
                               style={{ backgroundColor: 'var(--accent-900)' }}>
                            {JSON.stringify(JSON.parse(log.beforeJson), null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.afterJson && (
                        <div>
                          <p className="field-label mb-1">After</p>
                          <pre className="text-xs font-mono p-2 rounded overflow-x-auto text-green-400"
                               style={{ backgroundColor: 'var(--accent-900)' }}>
                            {JSON.stringify(JSON.parse(log.afterJson), null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-dark-base border-t border-dark-border z-20 grid grid-cols-4">
        <button onClick={() => router.push('/dashboard')} className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-gray-700 hover:text-gray-400 transition-colors">
          <Clock className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Home</span>
        </button>
        <button onClick={() => router.push('/worksites')} className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-gray-700 hover:text-gray-400 transition-colors">
          <Building2 className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Sites</span>
        </button>
        <button onClick={() => router.push('/reports')} className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-gray-700 hover:text-gray-400 transition-colors">
          <FileText className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Reports</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3" style={{ color: 'var(--accent-300)' }}>
          <Users className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Admin</span>
        </button>
      </nav>

    </div>
  );
}
