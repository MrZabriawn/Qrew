// src/app/admin/qbo/page.tsx
// QuickBooks Online integration admin — ED only.
// Manage the QBO OAuth connection, employee/customer/class mappings, and sync controls.
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock, Building2, Users, FileText, LogOut,
  AlertCircle, CheckCircle, RefreshCw, Link, Unlink,
  User, MapPin, Tag,
} from 'lucide-react';

type ConnectionStatus = 'active' | 'expired' | 'disconnected' | 'loading' | 'unconfigured';

interface SyncResult {
  success: boolean;
  message: string;
}

export default function QboPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();

  const [status,     setStatus]     = useState<ConnectionStatus>('loading');
  const [realmId,    setRealmId]    = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [syncBusy,   setSyncBusy]   = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
    if (!loading && user && user.role !== 'ED') router.push('/dashboard');
  }, [user, loading, router]);

  // Check QBO connection status via API
  useEffect(() => {
    if (!user || user.role !== 'ED') return;

    const check = async () => {
      try {
        const res = await fetch('/api/qbo/auth', { method: 'GET' }).catch(() => null);
        // In static export mode the API routes don't run server-side; we surface this gracefully
        if (!res || res.status === 404) {
          setStatus('unconfigured');
          return;
        }
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setStatus(data.status ?? 'disconnected');
          setRealmId(data.realmId ?? null);
          setConnectedAt(data.connectedAt ?? null);
        } else {
          setStatus('disconnected');
        }
      } catch {
        setStatus('unconfigured');
      }
    };

    check();
  }, [user]);

  const handleConnect = () => {
    // Redirect to the QBO OAuth auth endpoint
    window.location.href = '/api/qbo/auth';
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect QuickBooks Online? Existing sync data will be preserved.')) return;
    setError(null);
    try {
      const res = await fetch('/api/qbo/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
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
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setSyncResult({ success: true, message: `${label} synced successfully.` });
    } catch (err) {
      setSyncResult({ success: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncBusy(null);
      setTimeout(() => setSyncResult(null), 5000);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const isConnected = status === 'active';
  const isExpired   = status === 'expired';
  const isUnconfigured = status === 'unconfigured';

  const statusConfig = {
    active:        { label: 'Connected',      color: 'text-green-700',  dot: 'bg-green-500' },
    expired:       { label: 'Token Expired',  color: 'text-orange-600', dot: 'bg-orange-400' },
    disconnected:  { label: 'Not Connected',  color: 'text-gray-500',   dot: 'bg-gray-400' },
    loading:       { label: 'Checking…',      color: 'text-gray-400',   dot: 'bg-gray-300' },
    unconfigured:  { label: 'Not Configured', color: 'text-yellow-700', dot: 'bg-yellow-500' },
  }[status];

  const syncActions = [
    { label: 'Employees',  icon: User,  endpoint: '/api/qbo/sync/employees' },
    { label: 'Customers',  icon: MapPin, endpoint: '/api/qbo/sync/customers' },
    { label: 'Classes',    icon: Tag,   endpoint: '/api/qbo/sync/classes' },
  ];

  return (
    <div className="min-h-screen bg-white">

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

        {/* Title */}
        <div className="border-b border-gray-100 pb-4 mb-6">
          <p className="field-label">Payroll</p>
          <h2 className="text-lg font-bold text-gray-900 tracking-wide mt-1">QUICKBOOKS ONLINE</h2>
          <p className="text-xs font-mono mt-1 text-gray-500">
            OAuth connection · employee mappings · time activity sync
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            <button onClick={() => setError(null)} className="ml-auto">✕</button>
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

        {/* ── Connection status card ────────────────────────────────────── */}
        <div className="card mb-6">
          <p className="field-label mb-3">Connection</p>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${statusConfig.dot}`} />
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

            <div className="flex items-center gap-2">
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
              <p>To enable QBO integration, add the following to your <span className="font-semibold text-yellow-900">.env.local</span> and <span className="font-semibold text-yellow-900">Qrew/functions/.env</span>:</p>
              <ul className="mt-2 space-y-0.5 list-disc list-inside">
                <li>QBO_CLIENT_ID</li>
                <li>QBO_CLIENT_SECRET</li>
                <li>QBO_REDIRECT_URI</li>
                <li>QBO_ENCRYPTION_KEY</li>
                <li>QBO_OAUTH_STATE_SECRET</li>
                <li>QBO_ORG_ID</li>
              </ul>
              <p className="mt-2">See <span className="font-semibold text-yellow-900">.env.example</span> for full documentation.</p>
            </div>
          )}
        </div>

        {/* ── Sync controls ─────────────────────────────────────────────── */}
        <div className="card mb-6">
          <p className="field-label mb-3">Sync from QuickBooks</p>
          <p className="text-xs mb-4 text-gray-500">
            Pull employees, customers (job sites), and classes from QBO into Qrew for mapping.
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

        {/* ── Time activity push ────────────────────────────────────────── */}
        <div className="card mb-6">
          <p className="field-label mb-3">Push Time Activities</p>
          <p className="text-xs mb-4 text-gray-500">
            Approved shifts with complete employee and customer mappings are pushed to QBO as TimeActivity records.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => runSync('/api/qbo/timeactivities/push', 'Time activities')}
              disabled={!isConnected || syncBusy === '/api/qbo/timeactivities/push'}
              className="btn btn-primary text-xs flex items-center gap-2 disabled:opacity-40"
            >
              {syncBusy === '/api/qbo/timeactivities/push'
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              Push Approved Shifts
            </button>
            <button
              onClick={() => runSync('/api/qbo/timeactivities/retry', 'Retry queue')}
              disabled={!isConnected || syncBusy === '/api/qbo/timeactivities/retry'}
              className="btn btn-secondary text-xs flex items-center gap-2 disabled:opacity-40"
            >
              Retry Failed
            </button>
          </div>
        </div>

        {/* ── Info note ─────────────────────────────────────────────────── */}
        <div className="p-4 rounded-2xl border text-xs bg-gray-50 border-gray-200 text-gray-600">
          <p className="font-semibold text-gray-900 mb-2">How QBO sync works</p>
          <ol className="space-y-1 list-decimal list-inside">
            <li>Connect this app to your QBO company via OAuth above.</li>
            <li>Sync employees, customers, and classes from QBO.</li>
            <li>Map each Qrew worker → QBO Employee and each worksite → QBO Customer in the mappings screen.</li>
            <li>Approve shifts on the Reports page.</li>
            <li>Push approved shifts here — they appear as TimeActivity records in QBO.</li>
          </ol>
        </div>

      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-20 grid grid-cols-4">
        <button onClick={() => router.push('/dashboard')} className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: '#9ca3af' }}>
          <Clock className="w-5 h-5" /><span className="text-[10px] font-medium">Home</span>
        </button>
        <button onClick={() => router.push('/worksites')} className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: '#9ca3af' }}>
          <Building2 className="w-5 h-5" /><span className="text-[10px] font-medium">Sites</span>
        </button>
        <button onClick={() => router.push('/reports')} className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: '#9ca3af' }}>
          <FileText className="w-5 h-5" /><span className="text-[10px] font-medium">Reports</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1 py-3 transition-colors" style={{ color: 'var(--accent)' }}>
          <Users className="w-5 h-5" /><span className="text-[10px] font-medium">Admin</span>
        </button>
      </nav>

    </div>
  );
}
