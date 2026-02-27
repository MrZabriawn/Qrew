// src/app/admin/page.tsx
// User management page — ED only.
// Lists all users in the system and allows the ED to change roles, worker tiers,
// and active status. All changes are logged in the auditLogs collection.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  Save, AlertCircle, CheckCircle,
} from 'lucide-react';
import { getAllUsers, updateUser, createAuditLog } from '@/lib/db';
import type { User, UserRole, WorkerTier } from '@/types';
import { getRoleLabel } from '@/types';

// Local editable state per user row
interface UserEdit {
  role: UserRole;
  workerTier: WorkerTier | '';
  active: boolean;
  dirty: boolean;   // true if the user has changed anything in this row
  saving: boolean;
  saved: boolean;   // show a brief "Saved" confirmation
}

export default function AdminPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [edits, setEdits] = useState<Map<string, UserEdit>>(new Map());
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    try {
      const allUsers = await getAllUsers();
      // Sort: ED first, then PD, then workers; alphabetically within each group
      const order: Record<UserRole, number> = { ED: 0, PD: 1, TECH: 2, COORD: 2, TO: 2 };
      allUsers.sort((a, b) => {
        const diff = order[a.role] - order[b.role];
        return diff !== 0 ? diff : a.displayName.localeCompare(b.displayName);
      });
      setUsers(allUsers);

      // Initialise the edit state map from fresh data
      const map = new Map<string, UserEdit>();
      allUsers.forEach(u => {
        map.set(u.id, {
          role: u.role,
          workerTier: u.workerTier ?? '',
          active: u.active,
          dirty: false,
          saving: false,
          saved: false,
        });
      });
      setEdits(map);
    } catch (err) {
      console.error('Load users error:', err);
      setError('Failed to load users. Please refresh.');
    } finally {
      setDataLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateEdit = (userId: string, changes: Partial<UserEdit>) => {
    setEdits(prev => {
      const next = new Map(prev);
      const current = next.get(userId);
      if (current) next.set(userId, { ...current, ...changes, dirty: true });
      return next;
    });
  };

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    const isWorkerRole = ['TECH', 'COORD', 'TO'].includes(newRole);
    updateEdit(userId, {
      role: newRole,
      // Clear workerTier when changing to ED or PD; set a default for worker roles
      workerTier: isWorkerRole ? (newRole as WorkerTier) : '',
    });
  };

  const handleSaveUser = async (userId: string) => {
    const edit = edits.get(userId);
    const original = users.find(u => u.id === userId);
    if (!edit || !original || !user) return;

    setEdits(prev => {
      const next = new Map(prev);
      const cur = next.get(userId);
      if (cur) next.set(userId, { ...cur, saving: true });
      return next;
    });

    try {
      const updates: Partial<User> = {
        role: edit.role,
        active: edit.active,
        workerTier: edit.workerTier === '' ? undefined : edit.workerTier,
      };

      await updateUser(userId, updates);
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'USER_UPDATED',
        entityType: 'USER',
        entityId: userId,
        beforeJson: JSON.stringify({ role: original.role, active: original.active, workerTier: original.workerTier }),
        afterJson: JSON.stringify({ role: edit.role, active: edit.active, workerTier: edit.workerTier }),
      });

      setEdits(prev => {
        const next = new Map(prev);
        const cur = next.get(userId);
        if (cur) next.set(userId, { ...cur, saving: false, dirty: false, saved: true });
        return next;
      });

      // Clear the "Saved" badge after 2 seconds
      setTimeout(() => {
        setEdits(prev => {
          const next = new Map(prev);
          const cur = next.get(userId);
          if (cur) next.set(userId, { ...cur, saved: false });
          return next;
        });
      }, 2000);

      // Refresh the source-of-truth so subsequent saves have correct "before" data
      await loadData();
    } catch (err) {
      console.error('Save user error:', err);
      setError(`Failed to save changes for user.`);
      setEdits(prev => {
        const next = new Map(prev);
        const cur = next.get(userId);
        if (cur) next.set(userId, { ...cur, saving: false });
        return next;
      });
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

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
          <p className="field-label">System</p>
          <h2 className="text-lg font-bold text-white tracking-wide mt-1">USER MANAGEMENT</h2>
          <p className="text-xs text-gray-600 font-mono mt-1">Roles, tiers, and account status for all HOI staff</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Info note about new users */}
        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          New staff sign in with their HOI Google Workspace account — they appear here automatically
          with the default Operator role. Change their role below and click Save.
        </div>

        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="spinner" /></div>
        ) : users.length === 0 ? (
          <div className="card text-center py-12">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No Users Yet</h3>
            <p className="text-gray-500 text-sm mt-2">
              Users appear here after they sign in for the first time.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map(u => {
              const edit = edits.get(u.id);
              if (!edit) return null;
              const isWorkerRole = ['TECH', 'COORD', 'TO'].includes(edit.role);
              const isSelf = u.id === user.id;

              return (
                <div
                  key={u.id}
                  className={`card ${!u.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{u.displayName}</p>
                        {isSelf && (
                          <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">
                            You
                          </span>
                        )}
                        {edit.saved && (
                          <span className="flex items-center gap-1 text-xs text-green-700">
                            <CheckCircle className="w-3 h-3" />Saved
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{u.email}</p>
                    </div>

                    {/* Controls */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Role selector */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Role</label>
                        <select
                          className="input text-sm py-1"
                          value={edit.role}
                          onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                          disabled={isSelf} // prevent self-demotion lockout
                        >
                          <option value="ED">Executive Director</option>
                          <option value="PD">Program Director</option>
                          <option value="TECH">Technician</option>
                          <option value="COORD">Coordinator</option>
                          <option value="TO">Operator</option>
                        </select>
                        {isSelf && (
                          <p className="text-xs text-gray-400 mt-0.5">Cannot change own role</p>
                        )}
                      </div>

                      {/* Worker tier (only for worker roles) */}
                      {isWorkerRole && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Tier</label>
                          <select
                            className="input text-sm py-1"
                            value={edit.workerTier}
                            onChange={e => updateEdit(u.id, { workerTier: e.target.value as WorkerTier | '' })}
                          >
                            <option value="TO">Operator</option>
                            <option value="TECH">Technician</option>
                            <option value="COORD">Coordinator</option>
                          </select>
                        </div>
                      )}

                      {/* Active toggle */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Status</label>
                        <label className="flex items-center gap-2 cursor-pointer mt-1">
                          <input
                            type="checkbox"
                            checked={edit.active}
                            onChange={e => updateEdit(u.id, { active: e.target.checked })}
                            disabled={isSelf}
                            className="w-4 h-4 rounded"
                          />
                          <span className="text-sm text-gray-700">Active</span>
                        </label>
                      </div>

                      {/* Save button */}
                      <div className="self-end">
                        <button
                          onClick={() => handleSaveUser(u.id)}
                          disabled={!edit.dirty || edit.saving || isSelf}
                          className={`btn text-sm ${edit.dirty && !isSelf ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          <Save className="w-4 h-4 mr-1" />
                          {edit.saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Role description */}
                  <p className="text-xs text-gray-400 mt-2">
                    {getRoleLabel(edit.role)}
                    {isWorkerRole && edit.workerTier ? ` — ${edit.workerTier === 'TECH' ? 'Technician' : edit.workerTier === 'COORD' ? 'Coordinator' : 'Operator'}` : ''}
                    {!edit.active ? ' · Inactive (cannot log in)' : ''}
                  </p>
                </div>
              );
            })}
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
        <button onClick={() => router.push('/reports')} className="flex flex-col items-center justify-center gap-1 py-3 border-r border-dark-border text-gray-700 hover:text-gray-400 transition-colors">
          <FileText className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Reports</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3 text-primary-500">
          <Users className="w-4 h-4" /><span className="text-[8px] tracking-[0.15em] uppercase font-mono">Admin</span>
        </button>
      </nav>
    </div>
  );
}
