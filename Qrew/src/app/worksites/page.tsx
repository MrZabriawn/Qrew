// src/app/worksites/page.tsx
// Worksite management page — accessible to ED and PD.
// ED can create/edit/delete worksites and assign managers.
// PD can edit their managed worksites and start/end workdays.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  Plus, Edit2, X, Play, Square, UserPlus, AlertCircle,
} from 'lucide-react';
import {
  getAllWorksites, createWorksite, updateWorksite, getWorksitesByManager,
  createSiteDay, updateSiteDay, getOpenSiteDays, getSiteDayByWorksiteAndDate,
  getPunchesBySiteDay, createPunch, createShift, getAllUsers, createAuditLog,
} from '@/lib/db';
import type { Worksite, SiteDay, User } from '@/types';
import { formatTime, getLocalDateString, forceCloseOpenShifts, geocodeAddress } from '@/lib/utils';

interface WorksiteFormData {
  name: string;
  address: string;
  active: boolean;
  lat?: number;
  lng?: number;
}

export default function WorksitesPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteDayMap, setWorksiteDayMap] = useState<Map<string, SiteDay>>(new Map());
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingWorksite, setEditingWorksite] = useState<Worksite | null>(null);
  const [formData, setFormData] = useState<WorksiteFormData>({ name: '', address: '', active: true });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Assign managers modal state
  const [assigningWorksite, setAssigningWorksite] = useState<Worksite | null>(null);
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && !['ED', 'PD'].includes(user.role)) router.push('/dashboard');
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    setError(null);
    try {
      const [sites, openDays] = await Promise.all([
        user.role === 'ED' ? getAllWorksites(false) : getWorksitesByManager(user.id),
        getOpenSiteDays(),
      ]);
      setWorksites(sites);

      const dayMap = new Map<string, SiteDay>();
      openDays.forEach(sd => dayMap.set(sd.worksiteId, sd));
      setWorksiteDayMap(dayMap);

      if (user.role === 'ED') {
        setAllUsers(await getAllUsers());
      }
    } catch (err) {
      console.error('Load data error:', err);
      setError('Failed to load data. Please refresh.');
    } finally {
      setDataLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Create / Edit worksite ──────────────────────────────────────────────────

  const openCreateModal = () => {
    setEditingWorksite(null);
    setFormData({ name: '', address: '', active: true, lat: undefined, lng: undefined });
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (worksite: Worksite) => {
    setEditingWorksite(worksite);
    setFormData({ name: worksite.name, address: worksite.address, active: worksite.active, lat: worksite.lat, lng: worksite.lng });
    setFormError('');
    setShowModal(true);
  };

  const handleSaveWorksite = async () => {
    if (!user) return;
    if (!formData.name.trim()) { setFormError('Site name is required.'); return; }
    if (!formData.address.trim()) { setFormError('Address is required.'); return; }
    setFormLoading(true);
    try {
      // Geocode the address to lat/lng for geo-verification on clock-in.
      // Re-geocode if address changed from what's stored, or if coords are missing.
      const addressChanged = editingWorksite && formData.address.trim() !== editingWorksite.address;
      const needsGeocode = !formData.lat || !formData.lng || addressChanged;
      let geoFields: { lat?: number; lng?: number } = { lat: formData.lat, lng: formData.lng };
      if (needsGeocode) {
        const coords = await geocodeAddress(formData.address.trim());
        geoFields = coords ? { lat: coords.lat, lng: coords.lng } : {};
      }

      if (editingWorksite) {
        await updateWorksite(editingWorksite.id, {
          name: formData.name.trim(),
          address: formData.address.trim(),
          active: formData.active,
          ...geoFields,
        });
        await createAuditLog({
          actorUserId: user.id,
          actionType: 'WORKSITE_UPDATED',
          entityType: 'WORKSITE',
          entityId: editingWorksite.id,
          beforeJson: JSON.stringify({ name: editingWorksite.name, address: editingWorksite.address, active: editingWorksite.active }),
          afterJson: JSON.stringify({ name: formData.name, address: formData.address, active: formData.active }),
        });
      } else {
        const id = await createWorksite({
          name: formData.name.trim(),
          address: formData.address.trim(),
          active: formData.active,
          managers: [],
          ...geoFields,
        });
        await createAuditLog({
          actorUserId: user.id,
          actionType: 'WORKSITE_CREATED',
          entityType: 'WORKSITE',
          entityId: id,
          afterJson: JSON.stringify({ name: formData.name, address: formData.address }),
        });
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      console.error('Save worksite error:', err);
      setFormError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (worksite: Worksite) => {
    if (!user) return;
    setActionLoading(`toggle-${worksite.id}`);
    try {
      await updateWorksite(worksite.id, { active: !worksite.active });
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'WORKSITE_UPDATED',
        entityType: 'WORKSITE',
        entityId: worksite.id,
        beforeJson: JSON.stringify({ active: worksite.active }),
        afterJson: JSON.stringify({ active: !worksite.active }),
      });
      await loadData();
    } catch (err) {
      console.error('Toggle active error:', err);
      setError(`Failed to update worksite: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Start / End workday ─────────────────────────────────────────────────────

  const handleStartDay = async (worksiteId: string) => {
    if (!user) return;
    setActionLoading(`start-${worksiteId}`);
    try {
      const today = getLocalDateString();
      const existing = await getSiteDayByWorksiteAndDate(worksiteId, today);
      if (existing) {
        setError('A workday is already open for this site today.');
        return;
      }
      const siteDayId = await createSiteDay({
        worksiteId,
        date: today,
        status: 'OPEN',
        startedAt: new Date(),
        startedBy: user.id,
      });
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'SITEDAY_STARTED',
        entityType: 'SITEDAY',
        entityId: siteDayId,
      });
      await loadData();
    } catch (err) {
      console.error('Start day error:', err);
      setError(`Start day failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleEndDay = async (siteDay: SiteDay) => {
    const site = worksites.find(w => w.id === siteDay.worksiteId);
    if (!confirm(`End workday at "${site?.name ?? 'this site'}"? All open shifts will be auto-closed.`)) return;
    if (!user) return;
    setActionLoading(`end-${siteDay.id}`);
    try {
      const now = new Date();
      const punches = await getPunchesBySiteDay(siteDay.id);
      const { shifts, closingPunches } = forceCloseOpenShifts(punches, now);

      for (const cp of closingPunches) {
        await createPunch(cp);
      }
      for (const shift of shifts) {
        await createShift({
          siteDayId: shift.siteDayId,
          userId: shift.userId,
          inAt: shift.inAt,
          outAt: shift.outAt,
          durationMinutes: shift.durationMinutes,
          forcedOut: shift.forcedOut,
        });
      }
      await updateSiteDay(siteDay.id, { status: 'CLOSED', endedAt: now, endedBy: user.id });
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'SITEDAY_ENDED',
        entityType: 'SITEDAY',
        entityId: siteDay.id,
      });
      await loadData();
    } catch (err) {
      console.error('End day error:', err);
      setError(`End day failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Assign managers (ED only) ───────────────────────────────────────────────

  const openAssignManagers = (worksite: Worksite) => {
    setAssigningWorksite(worksite);
    setSelectedManagerIds([...worksite.managers]);
  };

  const handleSaveManagers = async () => {
    if (!assigningWorksite || !user) return;
    setAssignLoading(true);
    try {
      await updateWorksite(assigningWorksite.id, { managers: selectedManagerIds });
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'WORKSITE_UPDATED',
        entityType: 'WORKSITE',
        entityId: assigningWorksite.id,
        beforeJson: JSON.stringify({ managers: assigningWorksite.managers }),
        afterJson: JSON.stringify({ managers: selectedManagerIds }),
      });
      setAssigningWorksite(null);
      await loadData();
    } catch (err) {
      console.error('Assign managers error:', err);
      setError('Failed to save managers.');
    } finally {
      setAssignLoading(false);
    }
  };

  const pdUsers = allUsers.filter(u => u.role === 'PD');

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-base">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white max-w-md mx-auto">
      {/* Header */}
      <header className="border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white z-20">
        <div>
          <p className="text-[8px] text-gray-400 tracking-[0.4em] uppercase font-mono">Elder Systems</p>
          <p className="text-[11px] font-bold tracking-[0.25em] uppercase font-mono"
             style={{ color: 'var(--accent)' }}>Housing Workforce</p>
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
        {/* Page title + Add button */}
        <div className="flex items-center justify-between mb-6 border-b border-gray-100 pb-4">
          <div>
            <p className="field-label">Operations</p>
            <h2 className="text-lg font-bold text-gray-900 tracking-wide mt-1">WORKSITES</h2>
          </div>
          {user.role === 'ED' && (
            <button onClick={openCreateModal} className="btn btn-primary">
              <Plus className="w-4 h-4 mr-2" />Add Worksite
            </button>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Worksite list */}
        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="spinner" /></div>
        ) : worksites.length === 0 ? (
          <div className="card text-center py-12">
            <Building2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Worksites Yet</h3>
            <p className="text-gray-500 text-sm mb-4">
              {user.role === 'ED'
                ? 'Add your first worksite to get started.'
                : 'No worksites have been assigned to you yet.'}
            </p>
            {user.role === 'ED' && (
              <button onClick={openCreateModal} className="btn btn-primary">
                <Plus className="w-4 h-4 mr-2" />Add First Worksite
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {worksites.map(worksite => {
              const openSiteDay = worksiteDayMap.get(worksite.id);
              const managers = allUsers.filter(u => worksite.managers.includes(u.id));
              const startKey = `start-${worksite.id}`;
              const endKey = openSiteDay ? `end-${openSiteDay.id}` : '';
              const isBusy = actionLoading === startKey || actionLoading === endKey
                || actionLoading === `toggle-${worksite.id}`;

              return (
                <div key={worksite.id} className="card">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Name + badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold text-gray-900">{worksite.name}</h3>
                        <span className={`badge ${worksite.active ? 'badge-open' : 'badge-closed'}`}>
                          {worksite.active ? 'Active' : 'Inactive'}
                        </span>
                        {openSiteDay && <span className="badge badge-open">OPEN TODAY</span>}
                      </div>

                      <p className="text-sm text-gray-600 mb-2">{worksite.address}</p>

                      {managers.length > 0 && (
                        <p className="text-xs text-gray-500">
                          Managers: {managers.map(m => m.displayName).join(', ')}
                        </p>
                      )}

                      {openSiteDay && (
                        <p className="text-xs mt-1 font-medium"
                           style={{ color: 'var(--accent)' }}>
                          Open since {formatTime(openSiteDay.startedAt)}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {/* Start / End Day */}
                      {worksite.active && (
                        openSiteDay ? (
                          <button
                            onClick={() => handleEndDay(openSiteDay)}
                            disabled={isBusy}
                            className="btn btn-accent text-sm"
                          >
                            <Square className="w-4 h-4 mr-1" />
                            {actionLoading === endKey ? 'Ending…' : 'End Day'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartDay(worksite.id)}
                            disabled={isBusy}
                            className="btn btn-primary text-sm"
                          >
                            <Play className="w-4 h-4 mr-1" />
                            {actionLoading === startKey ? 'Starting…' : 'Start Day'}
                          </button>
                        )
                      )}

                      {/* Edit */}
                      <button
                        onClick={() => openEditModal(worksite)}
                        className="btn btn-secondary text-sm"
                      >
                        <Edit2 className="w-4 h-4 mr-1" />Edit
                      </button>

                      {/* ED-only: Assign Managers + Toggle Active */}
                      {user.role === 'ED' && (
                        <>
                          <button
                            onClick={() => openAssignManagers(worksite)}
                            className="btn btn-secondary text-sm"
                          >
                            <UserPlus className="w-4 h-4 mr-1" />Managers
                          </button>
                          <button
                            onClick={() => handleToggleActive(worksite)}
                            disabled={isBusy}
                            className="btn btn-secondary text-sm"
                          >
                            {worksite.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingWorksite ? 'Edit Worksite' : 'Add Worksite'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Site Name *</label>
                <input
                  className="input"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., 123 Main Street"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <input
                  className="input"
                  value={formData.address}
                  onChange={e => setFormData(prev => ({ ...prev, address: e.target.value, lat: undefined, lng: undefined }))}
                  placeholder="Full street address"
                />
                <p className="text-xs mt-1" style={{ color: formData.lat ? 'var(--accent)' : '#9ca3af' }}>
                  {formData.lat
                    ? `Coordinates on file — geo-check active`
                    : 'Coordinates will be geocoded from address on save'}
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={e => setFormData(prev => ({ ...prev, active: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700">Active</span>
              </label>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleSaveWorksite}
                disabled={formLoading}
                className="btn btn-primary flex-1"
              >
                {formLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Managers Modal (ED only) ────────────────────────────────── */}
      {assigningWorksite && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">
                Assign Managers — {assigningWorksite.name}
              </h3>
              <button onClick={() => setAssigningWorksite(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {pdUsers.length === 0 ? (
              <div className="text-center py-6">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">
                  No Program Directors found. Assign the PD role to users in the Admin panel first.
                </p>
              </div>
            ) : (
              <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
                {pdUsers.map(pd => (
                  <label
                    key={pd.id}
                    className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedManagerIds.includes(pd.id)}
                      onChange={e => {
                        setSelectedManagerIds(prev =>
                          e.target.checked ? [...prev, pd.id] : prev.filter(id => id !== pd.id)
                        );
                      }}
                      className="w-4 h-4 rounded"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{pd.displayName}</p>
                      <p className="text-xs text-gray-500">{pd.email}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setAssigningWorksite(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleSaveManagers}
                disabled={assignLoading || pdUsers.length === 0}
                className="btn btn-primary flex-1"
              >
                {assignLoading ? 'Saving…' : 'Save Managers'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 z-20 grid grid-cols-4">
        <button onClick={() => router.push('/dashboard')} className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: '#9ca3af' }}>
          <Clock className="w-5 h-5" /><span className="text-[10px] font-medium">Home</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: 'var(--accent)' }}>
          <Building2 className="w-5 h-5" /><span className="text-[10px] font-medium">Sites</span>
        </button>
        <button onClick={() => router.push('/reports')} className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: '#9ca3af' }}>
          <FileText className="w-5 h-5" /><span className="text-[10px] font-medium">Reports</span>
        </button>
        <button onClick={() => router.push('/admin')} className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: '#9ca3af' }}>
          <Users className="w-5 h-5" /><span className="text-[10px] font-medium">Admin</span>
        </button>
      </nav>
    </div>
  );
}
