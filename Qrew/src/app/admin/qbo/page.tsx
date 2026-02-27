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
    active:        { label: 'Connected',      color: 'text-green-400',  dot: 'bg-green-500' },
    expired:       { label: 'Token Expired',  color: 'text-orange-400', dot: 'bg-orange-400' },
    disconnected:  { label: 'Not Connected',  color: 'text-gray-400',   dot: 'bg-gray-500' },
    loading:       { label: 'Checking…',      color: 'text-gray-500',   dot: 'bg-gray-600' },
    unconfigured:  { label: 'Not Configured', color: 'text-yellow-400', dot: 'bg-yellow-500' },
  }[status];

  const syncActions = [
    { label: 'Employees',  icon: User,  endpoint: '/api/qbo/sync/employees' },
    { label: 'Customers',  icon: MapPin, endpoint: '/api/qbo/sync/customers' },
    { label: 'Classes',    icon: Tag,   endpoint: '/api/qbo/sync/classes' },
  ];

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
          <p className="field-label">Payroll</p>
          <h2 className="text-lg font-bold text-white tracking-wide mt-1">QUICKBOOKS ONLINE</h2>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
            OAuth connection · employee mappings · time activity sync
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            <button onClick={() => setError(null)} className="ml-auto">✕</button>
          </div>
        )}
        {syncResult && (
          <div className={`mb-4 p-3 rounded border text-sm flex items-center gap-2 ${
            syncResult.success
              ? 'bg-green-950 border-green-800 text-green-400'
              : 'bg-red-950 border-red-800 text-red-400'
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
            <div className="mt-4 p-3 rounded border text-xs font-mono"
                 style={{ backgroundColor: 'var(--dark-elevated)', borderColor: 'var(--dark-border2)', color: 'var(--text-muted)' }}>
              <p className="font-bold text-yellow-400 mb-2">Setup Required</p>
              <p>To enable QBO integration, add the following to your <span className="text-white">.env.local</span> and <span className="text-white">Qrew/functions/.env</span>:</p>
              <ul className="mt-2 space-y-0.5 list-disc list-inside">
                <li>QBO_CLIENT_ID</li>
                <li>QBO_CLIENT_SECRET</li>
                <li>QBO_REDIRECT_URI</li>
                <li>QBO_ENCRYPTION_KEY</li>
                <li>QBO_OAUTH_STATE_SECRET</li>
                <li>QBO_ORG_ID</li>
              </ul>
              <p className="mt-2">See <span className="text-white">.env.example</span> for full documentation.</p>
            </div>
          )}
        </div>

        {/* ── Sync controls ─────────────────────────────────────────────── */}
        <div className="card mb-6">
          <p className="field-label mb-3">Sync from QuickBooks</p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
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
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
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
        <div className="p-3 rounded border text-xs"
             style={{ backgroundColor: 'var(--dark-elevated)', borderColor: 'var(--dark-border2)', color: 'var(--text-muted)' }}>
          <p className="font-bold text-white mb-1">How QBO sync works</p>
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
