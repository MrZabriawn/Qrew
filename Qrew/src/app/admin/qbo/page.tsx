// src/app/admin/qbo/page.tsx
// QuickBooks Online integration admin — ED only.
// Two tabs: Overview (connection status, sync controls, push) and Mappings (employee/worksite).
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  AlertCircle, CheckCircle, RefreshCw, Link, Unlink,
  User, MapPin, Check, X,
} from 'lucide-react';
import {
  getAllUsers, getAllWorksites,
  getQboConnectionStatus, getQboEmployeeCache, getQboCustomerCache,
  getQboEmployeeMappings, setQboEmployeeMapping, deleteQboEmployeeMapping,
  getQboCustomerMappings, setQboCustomerMapping, deleteQboCustomerMapping,
} from '@/lib/db';
import type {
  User as AppUser,
  Worksite,
  QboEmployee,
  QboCustomer,
  QboEmployeeMapping,
  QboCustomerMapping,
} from '@/types';
import { isWorker, getRoleLabel } from '@/types';

type ConnectionStatus = 'active' | 'expired' | 'disconnected' | 'loading' | 'unconfigured';
type ActiveTab = 'overview' | 'mappings';

interface SyncResult {
  success: boolean;
  message: string;
}

const ORG_ID = process.env.NEXT_PUBLIC_QBO_ORG_ID ?? '';

export default function QboPage() {
  const { user, firebaseUser, signOut, loading } = useAuth();
  const router = useRouter();

  // ── Connection state ────────────────────────────────────────────────────────
  const [status,      setStatus]      = useState<ConnectionStatus>('loading');
  const [realmId,     setRealmId]     = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeTab,  setActiveTab]  = useState<ActiveTab>('overview');
  const [syncBusy,   setSyncBusy]   = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  // ── Mappings state ──────────────────────────────────────────────────────────
  const [mappingsLoaded,   setMappingsLoaded]   = useState(false);
  const [mappingsLoading,  setMappingsLoading]  = useState(false);
  const [workers,          setWorkers]          = useState<AppUser[]>([]);
  const [worksites,        setWorksites]        = useState<Worksite[]>([]);
  const [qboEmployees,     setQboEmployees]     = useState<QboEmployee[]>([]);
  const [qboCustomers,     setQboCustomers]     = useState<QboCustomer[]>([]);
  const [empMappings,      setEmpMappings]      = useState<Map<string, QboEmployeeMapping>>(new Map());
  const [custMappings,     setCustMappings]     = useState<Map<string, QboCustomerMapping>>(new Map());
  const [empSelections,    setEmpSelections]    = useState<Record<string, string>>({});
  const [custSelections,   setCustSelections]   = useState<Record<string, string>>({});
  const [savingEmp,        setSavingEmp]        = useState<Record<string, boolean>>({});
  const [savingCust,       setSavingCust]       = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  // Load connection status directly from Firestore (avoids broken API-redirect hack)
  useEffect(() => {
    if (!user || user.role !== 'ED') return;
    if (!ORG_ID) { setStatus('unconfigured'); return; }

    getQboConnectionStatus(ORG_ID)
      .then((info) => {
        if (!info) { setStatus('disconnected'); return; }
        if (info.status === 'active') setStatus('active');
        else if (info.status === 'revoked' || info.status === 'expired') setStatus('expired');
        else setStatus('disconnected');
        setRealmId(info.realmId ?? null);
        setConnectedAt(info.connectedAt?.toISOString() ?? null);
      })
      .catch(() => setStatus('unconfigured'));
  }, [user]);

  // Load mapping data on first visit to the Mappings tab
  useEffect(() => {
    if (activeTab === 'mappings' && !mappingsLoaded && user && ORG_ID) {
      loadMappingsData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mappingsLoaded, user]);

  const loadMappingsData = async () => {
    setMappingsLoading(true);
    setError(null);
    try {
      const [usersData, worksitesData, qboEmps, qboCusts, empList, custList] =
        await Promise.all([
          getAllUsers(),
          getAllWorksites(false),
          getQboEmployeeCache(ORG_ID),
          getQboCustomerCache(ORG_ID),
          getQboEmployeeMappings(ORG_ID),
          getQboCustomerMappings(ORG_ID),
        ]);

      setWorkers(
        usersData
          .filter(u => u.active && isWorker(u.role))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      );
      setWorksites(
        worksitesData
          .filter(w => w.active)
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setQboEmployees(
        qboEmps
          .filter(e => e.active)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      );
      setQboCustomers(
        qboCusts
          .filter(c => c.active)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      );

      const empMap = new Map<string, QboEmployeeMapping>();
      empList.forEach(m => empMap.set(m.userId, m));
      setEmpMappings(empMap);

      const custMap = new Map<string, QboCustomerMapping>();
      custList.forEach(m => custMap.set(m.worksiteId, m));
      setCustMappings(custMap);

      const empSel: Record<string, string> = {};
      empList.forEach(m => { empSel[m.userId] = m.qboEntityId; });
      setEmpSelections(empSel);

      const custSel: Record<string, string> = {};
      custList.forEach(m => { custSel[m.worksiteId] = m.qboCustomerId; });
      setCustSelections(custSel);

      setMappingsLoaded(true);
    } catch {
      setError('Failed to load mapping data. Check your connection and permissions.');
    } finally {
      setMappingsLoading(false);
    }
  };

  // ── Mapping save / clear handlers ───────────────────────────────────────────

  const saveEmpMapping = async (worker: AppUser) => {
    const qboEntityId = empSelections[worker.id];
    if (!qboEntityId) return;
    const qboEmp = qboEmployees.find(e => e.id === qboEntityId);
    if (!qboEmp) return;

    setSavingEmp(prev => ({ ...prev, [worker.id]: true }));
    try {
      await setQboEmployeeMapping(ORG_ID, worker.id, {
        userId:        worker.id,
        qboEntityId:   qboEmp.id,
        qboEntityType: qboEmp.type,
        qboDisplayName: qboEmp.displayName,
        mappedByUserId: user!.id,
      });
      setEmpMappings(prev => {
        const next = new Map(prev);
        next.set(worker.id, {
          userId:        worker.id,
          qboEntityId:   qboEmp.id,
          qboEntityType: qboEmp.type,
          qboDisplayName: qboEmp.displayName,
          mappedAt:      new Date(),
          mappedByUserId: user!.id,
        });
        return next;
      });
    } catch {
      setError('Failed to save employee mapping.');
    } finally {
      setSavingEmp(prev => ({ ...prev, [worker.id]: false }));
    }
  };

  const clearEmpMapping = async (userId: string) => {
    setSavingEmp(prev => ({ ...prev, [userId]: true }));
    try {
      await deleteQboEmployeeMapping(ORG_ID, userId);
      setEmpMappings(prev => { const next = new Map(prev); next.delete(userId); return next; });
      setEmpSelections(prev => { const next = { ...prev }; delete next[userId]; return next; });
    } catch {
      setError('Failed to clear employee mapping.');
    } finally {
      setSavingEmp(prev => ({ ...prev, [userId]: false }));
    }
  };

  const saveCustMapping = async (worksite: Worksite) => {
    const qboCustomerId = custSelections[worksite.id];
    if (!qboCustomerId) return;
    const qboCust = qboCustomers.find(c => c.id === qboCustomerId);
    if (!qboCust) return;

    setSavingCust(prev => ({ ...prev, [worksite.id]: true }));
    try {
      await setQboCustomerMapping(ORG_ID, worksite.id, {
        worksiteId:     worksite.id,
        qboCustomerId:  qboCust.id,
        qboDisplayName: qboCust.displayName,
        mappedByUserId: user!.id,
      });
      setCustMappings(prev => {
        const next = new Map(prev);
        next.set(worksite.id, {
          worksiteId:     worksite.id,
          qboCustomerId:  qboCust.id,
          qboDisplayName: qboCust.displayName,
          mappedAt:       new Date(),
          mappedByUserId: user!.id,
        });
        return next;
      });
    } catch {
      setError('Failed to save worksite mapping.');
    } finally {
      setSavingCust(prev => ({ ...prev, [worksite.id]: false }));
    }
  };

  const clearCustMapping = async (worksiteId: string) => {
    setSavingCust(prev => ({ ...prev, [worksiteId]: true }));
    try {
      await deleteQboCustomerMapping(ORG_ID, worksiteId);
      setCustMappings(prev => { const next = new Map(prev); next.delete(worksiteId); return next; });
      setCustSelections(prev => { const next = { ...prev }; delete next[worksiteId]; return next; });
    } catch {
      setError('Failed to clear worksite mapping.');
    } finally {
      setSavingCust(prev => ({ ...prev, [worksiteId]: false }));
    }
  };

  // ── OAuth / sync handlers ───────────────────────────────────────────────────

  const handleConnect = async () => {
    if (!ORG_ID || !firebaseUser) return;
    setError(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/qbo/auth?orgId=${ORG_ID}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'X-Return-Url':  '1',
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect QuickBooks Online? Existing sync data will be preserved.')) return;
    setError(null);
    try {
      const idToken = await firebaseUser!.getIdToken();
      const res = await fetch('/api/qbo/disconnect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ orgId: ORG_ID }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setStatus('disconnected');
      setRealmId(null);
      setConnectedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runSync = async (endpoint: string, label: string) => {
    setSyncBusy(endpoint);
    setSyncResult(null);
    setError(null);
    try {
      const idToken = await firebaseUser!.getIdToken();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ orgId: ORG_ID }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setSyncResult({ success: true, message: `${label} synced successfully.` });
      // Invalidate mappings cache so it reloads with fresh QBO data
      if (endpoint.includes('employees') || endpoint.includes('customers')) {
        setMappingsLoaded(false);
      }
    } catch (err) {
      setSyncResult({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSyncBusy(null);
      setTimeout(() => setSyncResult(null), 6000);
    }
  };

  // ── Loading / auth guard ────────────────────────────────────────────────────

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const isConnected    = status === 'active';
  const isExpired      = status === 'expired';
  const isUnconfigured = status === 'unconfigured';

  const statusConfig = {
    active:       { label: 'Connected',      color: 'text-green-700',  dot: 'bg-green-500' },
    expired:      { label: 'Token Expired',  color: 'text-orange-600', dot: 'bg-orange-400' },
    disconnected: { label: 'Not Connected',  color: 'text-gray-500',   dot: 'bg-gray-400' },
    loading:      { label: 'Checking…',      color: 'text-gray-400',   dot: 'bg-gray-300' },
    unconfigured: { label: 'Not Configured', color: 'text-yellow-700', dot: 'bg-yellow-500' },
  }[status];

  const syncActions = [
    { label: 'Employees', icon: User,   endpoint: '/api/qbo/sync/employees' },
    { label: 'Customers', icon: MapPin, endpoint: '/api/qbo/sync/customers' },
    { label: 'Classes',   icon: FileText, endpoint: '/api/qbo/sync/classes' },
  ];

  const empMappedCount  = workers.filter(w => empMappings.has(w.id)).length;
  const custMappedCount = worksites.filter(w => custMappings.has(w.id)).length;

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

      {/* Page title */}
      <div className="px-4 sm:px-6 pt-6 pb-0 border-b border-gray-100">
        <p className="field-label">Payroll</p>
        <h2 className="text-lg font-bold text-gray-900 tracking-wide mt-1">QUICKBOOKS ONLINE</h2>
        <p className="text-xs font-mono mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          OAuth connection · employee mappings · time activity sync
        </p>

        {/* Tab bar */}
        <div className="flex gap-0 -mb-px">
          {(['overview', 'mappings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="py-2.5 px-5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors"
              style={
                activeTab === tab
                  ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                  : { borderColor: 'transparent', color: '#9ca3af' }
              }
            >
              {tab === 'overview' ? 'Overview' : (
                <span className="flex items-center gap-1.5">
                  Mappings
                  {mappingsLoaded && (empMappedCount > 0 || custMappedCount > 0) && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--accent-900)', color: 'var(--accent)' }}>
                      {empMappedCount + custMappedCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 sm:px-6 py-6 pb-24">

        {/* Global banners */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            <button onClick={() => setError(null)} className="ml-auto hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {syncResult && (
          <div className={`mb-4 p-4 rounded-2xl border text-sm flex items-center gap-2 ${
            syncResult.success
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {syncResult.success
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {syncResult.message}
          </div>
        )}

        {/* ═══ OVERVIEW TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Connection status card */}
            <div className="card mb-6">
              <p className="field-label mb-3">Connection</p>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusConfig.dot}`} />
                  <div>
                    <p className={`font-semibold text-sm ${statusConfig.color}`}>{statusConfig.label}</p>
                    {realmId && (
                      <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Company ID: {realmId}
                      </p>
                    )}
                    {connectedAt && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Connected {new Date(connectedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {(isConnected || isExpired) && (
                    <button
                      onClick={handleDisconnect}
                      className="btn btn-secondary text-xs flex items-center gap-1.5"
                    >
                      <Unlink className="w-3 h-3" />Disconnect
                    </button>
                  )}
                  {(!isConnected || isExpired) && !isUnconfigured && (
                    <button
                      onClick={handleConnect}
                      className="btn btn-primary text-xs flex items-center gap-1.5"
                    >
                      <Link className="w-3 h-3" />
                      {isExpired ? 'Reconnect' : 'Connect to QBO'}
                    </button>
                  )}
                </div>
              </div>

              {isUnconfigured && (
                <div className="mt-4 p-4 rounded-2xl border text-xs font-mono bg-yellow-50 border-yellow-200 text-yellow-800">
                  <p className="font-bold mb-2">Setup Required</p>
                  <p>Add the following to <span className="font-semibold">Qrew/.env.local</span>:</p>
                  <ul className="mt-2 space-y-0.5 list-disc list-inside">
                    <li>QBO_CLIENT_ID</li>
                    <li>QBO_CLIENT_SECRET</li>
                    <li>QBO_REDIRECT_URI</li>
                    <li>QBO_ENCRYPTION_KEY</li>
                    <li>QBO_OAUTH_STATE_SECRET</li>
                    <li>QBO_ORG_ID + NEXT_PUBLIC_QBO_ORG_ID</li>
                  </ul>
                  <p className="mt-2">See <span className="font-semibold">.env.local</span> for full documentation.</p>
                </div>
              )}
            </div>

            {/* Sync from QBO card */}
            <div className="card mb-6">
              <p className="field-label mb-1">Sync from QuickBooks</p>
              <p className="text-xs mb-4 text-gray-500">
                Pull the latest employees, customers (job sites), and classes from QBO into Qrew.
                Run this whenever the QBO roster changes, then update mappings.
              </p>
              <div className="grid grid-cols-3 gap-3">
                {syncActions.map(({ label, icon: Icon, endpoint }) => (
                  <button
                    key={endpoint}
                    onClick={() => runSync(endpoint, label)}
                    disabled={!isConnected || syncBusy === endpoint}
                    className="btn btn-secondary text-xs flex flex-col items-center gap-1.5 py-3 disabled:opacity-40"
                  >
                    {syncBusy === endpoint
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Icon className="w-4 h-4" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Push time activities card */}
            <div className="card mb-6">
              <p className="field-label mb-1">Push Time Activities</p>
              <p className="text-xs mb-4 text-gray-500">
                Approved shifts (from Reports → Payroll) with complete mappings are pushed to QBO
                as TimeActivity records. Use Retry Failed for any that errored.
              </p>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => runSync('/api/qbo/timeactivities/retry', 'Retry queue')}
                  disabled={!isConnected || syncBusy === '/api/qbo/timeactivities/retry'}
                  className="btn btn-secondary text-xs flex items-center gap-2 disabled:opacity-40"
                >
                  {syncBusy === '/api/qbo/timeactivities/retry'
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Retry Failed
                </button>
              </div>
            </div>

            {/* How it works */}
            <div className="p-4 rounded-2xl border text-xs bg-gray-50 border-gray-200 text-gray-600">
              <p className="font-semibold text-gray-900 mb-2">How QBO sync works</p>
              <ol className="space-y-1 list-decimal list-inside">
                <li>Connect this app to your QBO company via OAuth above.</li>
                <li>Sync employees, customers, and classes from QBO.</li>
                <li>Open the <strong>Mappings</strong> tab — link each Qrew worker to a QBO Employee and each worksite to a QBO Customer.</li>
                <li>Go to <strong>Reports → Payroll</strong> and approve the shifts for the pay period.</li>
                <li>Push approved shifts to QBO individually from the Payroll tab.</li>
                <li>Use <strong>Retry Failed</strong> above to re-attempt any that errored.</li>
              </ol>
            </div>
          </>
        )}

        {/* ═══ MAPPINGS TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'mappings' && (
          <>
            {mappingsLoading && (
              <div className="flex justify-center py-16">
                <div className="spinner" />
              </div>
            )}

            {!mappingsLoading && (
              <>
                {/* Reload button */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => { setMappingsLoaded(false); }}
                    className="btn btn-secondary text-xs flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />Reload
                  </button>
                </div>

                {/* ── Employee Mappings ───────────────────────────────────── */}
                <div className="card mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="field-label">Employee Mappings</p>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {empMappedCount} / {workers.length} mapped
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    Link each Qrew worker to their matching QBO Employee or Vendor (1099).
                    Shifts cannot be pushed until the worker is mapped.
                  </p>

                  {qboEmployees.length === 0 ? (
                    <div className="p-4 rounded-xl border border-yellow-200 bg-yellow-50 text-xs text-yellow-800">
                      No QBO employees cached. Go to <strong>Overview → Sync from QuickBooks → Employees</strong> first.
                    </div>
                  ) : workers.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">No active workers found.</p>
                  ) : (
                    <div className="space-y-3">
                      {workers.map(worker => {
                        const mapped  = empMappings.get(worker.id);
                        const saving  = savingEmp[worker.id] ?? false;
                        const sel     = empSelections[worker.id] ?? '';
                        const isDirty = sel !== (mapped?.qboEntityId ?? '');

                        return (
                          <div key={worker.id}
                               className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                            {/* Worker header */}
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{worker.displayName}</p>
                                <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                                  {getRoleLabel(worker.role)}
                                </p>
                              </div>
                              {mapped && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1"
                                      style={{ background: 'var(--accent-900)', color: 'var(--accent)' }}>
                                  <Check className="w-3 h-3" />
                                  {mapped.qboEntityType}
                                </span>
                              )}
                            </div>

                            {/* Dropdown + actions */}
                            <div className="flex items-center gap-2">
                              <select
                                className="input text-xs flex-1"
                                value={sel}
                                onChange={e => setEmpSelections(prev => ({ ...prev, [worker.id]: e.target.value }))}
                                disabled={saving}
                              >
                                <option value="">— Select QBO Employee / Vendor —</option>
                                {qboEmployees.map(e => (
                                  <option key={e.id} value={e.id}>
                                    [{e.type === 'Employee' ? 'EMP' : '1099'}] {e.displayName}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => saveEmpMapping(worker)}
                                disabled={saving || !sel || !isDirty}
                                className="btn btn-primary text-xs flex items-center gap-1 py-2 px-3 disabled:opacity-40"
                              >
                                {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Save
                              </button>
                              {mapped && (
                                <button
                                  onClick={() => clearEmpMapping(worker.id)}
                                  disabled={saving}
                                  className="btn btn-accent text-xs py-2 px-3 disabled:opacity-40"
                                  title="Clear mapping"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {mapped && (
                              <p className="text-[10px] font-mono mt-1.5" style={{ color: 'var(--text-muted)' }}>
                                → {mapped.qboDisplayName}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Worksite → Customer Mappings ────────────────────────── */}
                <div className="card mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="field-label">Worksite Mappings</p>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {custMappedCount} / {worksites.length} mapped
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    Link each Qrew worksite to a QBO Customer (job). This populates the CustomerRef on time entries,
                    enabling job-cost reports in QBO. Customer mapping is optional — shifts push without it, but without a job link.
                  </p>

                  {qboCustomers.length === 0 ? (
                    <div className="p-4 rounded-xl border border-yellow-200 bg-yellow-50 text-xs text-yellow-800">
                      No QBO customers cached. Go to <strong>Overview → Sync from QuickBooks → Customers</strong> first.
                    </div>
                  ) : worksites.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">No active worksites found.</p>
                  ) : (
                    <div className="space-y-3">
                      {worksites.map(worksite => {
                        const mapped  = custMappings.get(worksite.id);
                        const saving  = savingCust[worksite.id] ?? false;
                        const sel     = custSelections[worksite.id] ?? '';
                        const isDirty = sel !== (mapped?.qboCustomerId ?? '');

                        return (
                          <div key={worksite.id}
                               className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                            {/* Worksite header */}
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{worksite.name}</p>
                                <p className="text-[10px] font-mono text-gray-400 mt-0.5 truncate max-w-[180px]">
                                  {worksite.address}
                                </p>
                              </div>
                              {mapped && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"
                                      style={{ background: 'var(--accent-900)', color: 'var(--accent)' }}>
                                  <Check className="w-3 h-3" />
                                  Job
                                </span>
                              )}
                            </div>

                            {/* Dropdown + actions */}
                            <div className="flex items-center gap-2">
                              <select
                                className="input text-xs flex-1"
                                value={sel}
                                onChange={e => setCustSelections(prev => ({ ...prev, [worksite.id]: e.target.value }))}
                                disabled={saving}
                              >
                                <option value="">— Select QBO Customer / Job —</option>
                                {qboCustomers.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.fullyQualifiedName ?? c.displayName}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => saveCustMapping(worksite)}
                                disabled={saving || !sel || !isDirty}
                                className="btn btn-primary text-xs flex items-center gap-1 py-2 px-3 disabled:opacity-40"
                              >
                                {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Save
                              </button>
                              {mapped && (
                                <button
                                  onClick={() => clearCustMapping(worksite.id)}
                                  disabled={saving}
                                  className="btn btn-accent text-xs py-2 px-3 disabled:opacity-40"
                                  title="Clear mapping"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {mapped && (
                              <p className="text-[10px] font-mono mt-1.5" style={{ color: 'var(--text-muted)' }}>
                                → {mapped.qboDisplayName}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* Bottom nav */}
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
        <button onClick={() => router.push('/reports')}
                className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
                style={{ color: '#9ca3af' }}>
          <FileText className="w-5 h-5" /><span className="text-[10px] font-medium">Reports</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
                style={{ color: 'var(--accent)' }}>
          <Users className="w-5 h-5" /><span className="text-[10px] font-medium">Admin</span>
        </button>
      </nav>

    </div>
  );
}
