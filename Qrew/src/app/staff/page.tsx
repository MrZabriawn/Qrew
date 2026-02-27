// src/app/staff/page.tsx
// Staff directory — ED only.
// Lists all worker-level accounts (TO, TECH, COORD) with tier and active status.
// For full role/tier editing use /admin.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  AlertCircle, CheckCircle, UserX, UserCheck,
} from 'lucide-react';
import { getAllUsers, updateUser, createAuditLog } from '@/lib/db';
import type { User, WorkerTier } from '@/types';
import { getWorkerTierLabel } from '@/types';

export default function StaffPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();

  const [workers, setWorkers]       = useState<User[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionId, setActionId]     = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    try {
      const all = await getAllUsers();
      const workerRoles = ['TECH', 'COORD', 'TO'];
      const filtered = all
        .filter(u => workerRoles.includes(u.role))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.displayName.localeCompare(b.displayName);
        });
      setWorkers(filtered);
    } catch (err) {
      console.error(err);
      setError('Failed to load staff.');
    } finally {
      setDataLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggleActive = async (worker: User) => {
    if (!user || actionId) return;
    setActionId(worker.id);
    setError(null);
    try {
      await updateUser(worker.id, { active: !worker.active });
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'USER_UPDATED',
        entityType: 'USER',
        entityId: worker.id,
        beforeJson: JSON.stringify({ active: worker.active }),
        afterJson:  JSON.stringify({ active: !worker.active }),
      });
      setSuccessMsg(`${worker.displayName} ${worker.active ? 'deactivated' : 'activated'}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const tierBadge: Record<WorkerTier, string> = {
    TECH:  'text-blue-400 border-blue-800 bg-blue-950',
    COORD: 'text-purple-400 border-purple-800 bg-purple-950',
    TO:    'text-gray-400 border-dark-border2',
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const active   = workers.filter(w => w.active);
  const inactive = workers.filter(w => !w.active);

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

        {/* Title row */}
        <div className="border-b border-dark-border pb-4 mb-6 flex items-end justify-between">
          <div>
            <p className="field-label">Personnel</p>
            <h2 className="text-lg font-bold text-white tracking-wide mt-1">STAFF DIRECTORY</h2>
            <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
              Worker accounts — TO, TECH, COORD
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="btn btn-secondary text-xs"
          >
            Full Admin →
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded text-sm flex items-center gap-2 border"
               style={{ backgroundColor: 'var(--accent-900)', borderColor: 'var(--accent-800)', color: 'var(--accent-300)' }}>
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            {successMsg}
          </div>
        )}

        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="spinner" /></div>
        ) : workers.length === 0 ? (
          <div className="card text-center py-12">
            <Users className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="font-medium text-white">No workers yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Staff appear here after signing in for the first time.
            </p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Active workers */}
            {active.length > 0 && (
              <section>
                <p className="field-label mb-3">Active — {active.length}</p>
                <div className="space-y-2">
                  {active.map(w => (
                    <div key={w.id} className="card p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-white text-sm">{w.displayName}</p>
                          {w.workerTier && (
                            <span className={`badge text-[10px] border ${tierBadge[w.workerTier]}`}>
                              {getWorkerTierLabel(w.workerTier)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{w.email}</p>
                      </div>
                      <button
                        onClick={() => handleToggleActive(w)}
                        disabled={actionId === w.id}
                        className="btn btn-secondary text-xs shrink-0 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <UserX className="w-3 h-3" />Deactivate
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Inactive workers */}
            {inactive.length > 0 && (
              <section>
                <p className="field-label mb-3">Inactive — {inactive.length}</p>
                <div className="space-y-2">
                  {inactive.map(w => (
                    <div key={w.id} className="card p-4 flex items-center justify-between gap-4 opacity-50">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-white text-sm">{w.displayName}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{w.email}</p>
                      </div>
                      <button
                        onClick={() => handleToggleActive(w)}
                        disabled={actionId === w.id}
                        className="btn btn-secondary text-xs shrink-0 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <UserCheck className="w-3 h-3" />Activate
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

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
          <Users className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Staff</span>
        </button>
      </nav>

    </div>
  );
}
