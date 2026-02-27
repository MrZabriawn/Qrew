// src/app/dashboard/page.tsx
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileText, LogOut, Settings, Clock } from 'lucide-react';
import {
  getOpenSiteDays, getWorksitesByManager, getAllWorksites,
  createPunch, createSiteDay, updateSiteDay,
  getPunchesBySiteDay, createShift, getPunchesByUser,
  getSiteDayByWorksiteAndDate, createAuditLog,
} from '@/lib/db';
import type { SiteDay, Worksite } from '@/types';
import { getLocalDateString, forceCloseOpenShifts } from '@/lib/utils';

// ── helpers ───────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatElapsed(from: Date, now: Date): string {
  const totalSec = Math.floor((now.getTime() - from.getTime()) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function padTwo(n: number) { return String(n).padStart(2, '0'); }

// ── component ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();

  // page state
  const [mounted,     setMounted]     = useState(false);
  const [activeTab,   setActiveTab]   = useState<'clock' | 'sites' | 'reports' | 'admin'>('clock');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy,        setBusy]        = useState(false);

  // clock
  const [now,         setNow]         = useState(new Date());
  const [clockInTime, setClockInTime] = useState<Date | null>(null);

  // sites / punches
  const [openSiteDays,   setOpenSiteDays]   = useState<SiteDay[]>([]);
  const [myWorksites,    setMyWorksites]     = useState<Worksite[]>([]);
  const [allWorksites,   setAllWorksites]    = useState<Worksite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [dataLoaded,     setDataLoaded]      = useState(false);

  // ── tick ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── redirect if no user ───────────────────────────────────────────────────
  useEffect(() => {
    if (mounted && !loading && !user) router.replace('/');
  }, [mounted, loading, user, router]);

  // ── load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [siteDays, worksites] = await Promise.all([
        getOpenSiteDays(),
        user.role === 'ED' ? getAllWorksites() : getWorksitesByManager(user.id),
      ]);
      setOpenSiteDays(siteDays);
      setMyWorksites(worksites);
      if (user.role === 'ED') setAllWorksites(worksites);

      // find clock-in time from today's punches
      const todayPunches = await getPunchesByUser(user.id, 20);
      const todayStr = getLocalDateString(new Date());
      let lastIn: Date | null = null;
      for (const p of todayPunches) {
        const pDate = p.timestamp instanceof Date ? p.timestamp : (p.timestamp as { toDate(): Date }).toDate();
        if (getLocalDateString(pDate) === todayStr && p.type === 'IN') {
          if (!lastIn || pDate > lastIn) lastIn = pDate;
        }
      }
      let hasOutAfterLastIn = false;
      if (lastIn) {
        for (const p of todayPunches) {
          const pDate = p.timestamp instanceof Date ? p.timestamp : (p.timestamp as { toDate(): Date }).toDate();
          if (p.type === 'OUT' && pDate > lastIn) { hasOutAfterLastIn = true; break; }
        }
      }
      setClockInTime(lastIn && !hasOutAfterLastIn ? lastIn : null);
      setDataLoaded(true);
    } catch (e) {
      console.error(e);
    }
  }, [user]);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  // ── site selection default ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedSiteId && myWorksites.length === 1) {
      setSelectedSiteId(myWorksites[0].id);
    }
  }, [myWorksites, selectedSiteId]);

  // ── punch ─────────────────────────────────────────────────────────────────
  const handlePunch = useCallback(async (type: 'IN' | 'OUT') => {
    if (!user || busy) return;
    setActionError(null);
    setBusy(true);
    try {
      const siteId = selectedSiteId || (myWorksites[0]?.id ?? '');
      if (!siteId) throw new Error('No worksite selected');
      const today = getLocalDateString(new Date());
      const existing = await getSiteDayByWorksiteAndDate(siteId, today);

      let siteDayId: string;
      if (!existing) {
        if (type === 'OUT') throw new Error('No open shift to clock out from');
        siteDayId = await createSiteDay({
          worksiteId: siteId,
          date: today,
          status: 'OPEN',
          startedAt: new Date(),
          startedBy: user.id,
        });
      } else {
        siteDayId = existing.id;
      }

      await createPunch({
        userId: user.id,
        siteDayId,
        type,
        timestamp: new Date(),
        source: 'web',
      });

      if (type === 'IN') {
        setClockInTime(new Date());
      } else {
        setClockInTime(null);
        const punches = await getPunchesBySiteDay(siteDayId);
        const { shifts, closingPunches } = forceCloseOpenShifts(punches, new Date());
        for (const s of shifts) {
          await createShift({ ...s, siteDayId, userId: user.id });
        }
        for (const p of closingPunches) {
          await createPunch(p);
        }
      }

      await createAuditLog({
        actorUserId: user.id,
        actionType: 'PUNCH_CREATED',
        entityType: 'PUNCH',
        entityId: siteDayId,
      });
      await loadData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [user, busy, selectedSiteId, myWorksites, loadData]);

  // ── site day controls ─────────────────────────────────────────────────────
  const handleStartDay = useCallback(async (worksiteId: string) => {
    if (!user || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const today = getLocalDateString(new Date());
      const existing = await getSiteDayByWorksiteAndDate(worksiteId, today);
      if (existing) throw new Error('Day already started for this site');
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
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [user, busy, loadData]);

  const handleEndDay = useCallback(async (siteDayId: string) => {
    if (!user || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await updateSiteDay(siteDayId, { status: 'CLOSED', endedAt: new Date(), endedBy: user.id });
      await createAuditLog({
        actorUserId: user.id,
        actionType: 'SITEDAY_ENDED',
        entityType: 'SITEDAY',
        entityId: siteDayId,
      });
      await loadData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [user, busy, loadData]);

  // ── derived ───────────────────────────────────────────────────────────────
  const firstName = user?.displayName?.split(' ')[0] ?? 'there';
  const isED      = user?.role === 'ED';
  const isPD      = user?.role === 'PD';
  const isStaff   = !isED && !isPD;
  const clockedIn = clockInTime !== null;

  const displayWorksites = isED ? allWorksites : myWorksites;

  // ── render guards ─────────────────────────────────────────────────────────
  if (!mounted || loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="spinner" />
      </div>
    );
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'clock',   label: 'Clock',   icon: Clock },
    { id: 'sites',   label: 'Sites',   icon: Building2 },
    { id: 'reports', label: 'Reports', icon: FileText },
    ...(isED ? [{ id: 'admin' as const, label: 'Admin', icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col max-w-md mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hoi-logo.png" alt="HOI" className="h-8 w-auto object-contain" />
          <div>
            <p className="text-[9px] text-gray-400 font-mono tracking-widest uppercase leading-none">
              Elder Systems
            </p>
            <p className="text-[11px] font-bold font-mono tracking-wide uppercase leading-none mt-0.5"
               style={{ color: 'var(--accent)' }}>
              Housing Workforce
            </p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pb-24">

        {/* ── Clock Tab ────────────────────────────────────────────────── */}
        {activeTab === 'clock' && (
          <div className="px-5 py-5 flex flex-col gap-5 fade-in">

            {/* Greeting */}
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {getGreeting()}, {firstName}
              </p>
              <p className="text-sm text-gray-400 mt-0.5">
                {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>

            {/* Live clock card */}
            <div className="rounded-3xl px-6 py-7 flex flex-col items-center gap-1"
                 style={{ backgroundColor: '#12122a' }}>
              <p
                className="font-mono font-bold leading-none tabular-nums"
                style={{ fontSize: 'clamp(3.5rem, 18vw, 5.5rem)', color: '#ffffff' }}
              >
                {padTwo(now.getHours() % 12 || 12)}
                <span style={{ color: 'var(--accent)' }} className="animate-pulse">:</span>
                {padTwo(now.getMinutes())}
                <span style={{ color: 'var(--accent)' }} className="animate-pulse">:</span>
                {padTwo(now.getSeconds())}
              </p>
              <p className="text-xs text-gray-400 font-mono tracking-widest uppercase mt-1">
                {now.getHours() < 12 ? 'AM' : 'PM'}
              </p>
            </div>

            {/* Status pill */}
            {clockedIn && clockInTime ? (
              <div className="flex items-center justify-between rounded-2xl px-5 py-4 bg-green-50 border border-green-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium text-green-800">Clocked in</span>
                </div>
                <span className="text-sm font-semibold text-green-700 font-mono">
                  {formatElapsed(clockInTime, now)}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-2xl px-5 py-4 bg-gray-50 border border-gray-200">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                <span className="text-sm text-gray-400">Not clocked in</span>
              </div>
            )}

            {/* Site picker (shown when user has multiple sites) */}
            {(isStaff || isPD) && myWorksites.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                  Site
                </label>
                <select
                  value={selectedSiteId}
                  onChange={e => setSelectedSiteId(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3.5 text-sm
                             text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                >
                  <option value="">Select a site…</option>
                  {myWorksites.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Punch buttons */}
            {(isStaff || isPD) && (
              <div className="flex flex-col gap-3">
                {!clockedIn ? (
                  <button
                    onClick={() => handlePunch('IN')}
                    disabled={busy || (myWorksites.length > 1 && !selectedSiteId)}
                    className="w-full py-5 rounded-2xl text-white text-base font-semibold
                               transition-all active:scale-[0.98] disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Clocking in…
                      </span>
                    ) : 'Clock In'}
                  </button>
                ) : (
                  <button
                    onClick={() => handlePunch('OUT')}
                    disabled={busy}
                    className="w-full py-5 rounded-2xl text-gray-900 text-base font-semibold
                               border-2 border-gray-900 hover:bg-gray-900 hover:text-white
                               transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
                        Clocking out…
                      </span>
                    ) : 'Clock Out'}
                  </button>
                )}
              </div>
            )}

            {/* Error */}
            {actionError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs text-red-700">{actionError}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Sites Tab ────────────────────────────────────────────────── */}
        {activeTab === 'sites' && (
          <div className="px-5 py-5 flex flex-col gap-4 fade-in">
            <h2 className="text-lg font-semibold text-gray-900">Sites</h2>

            {!dataLoaded ? (
              <div className="flex justify-center py-10"><div className="spinner" /></div>
            ) : displayWorksites.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No worksites assigned.</p>
            ) : (
              displayWorksites.map(ws => {
                const openDay = openSiteDays.find(sd => sd.worksiteId === ws.id);
                return (
                  <div
                    key={ws.id}
                    className={`rounded-2xl border px-5 py-4 flex items-center justify-between
                                ${openDay ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{ws.name}</p>
                      {ws.address && (
                        <p className="text-xs text-gray-400 mt-0.5">{ws.address}</p>
                      )}
                      {openDay && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-green-700">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Open today
                        </span>
                      )}
                    </div>
                    {(isPD || isED) && (
                      openDay ? (
                        <button
                          onClick={() => handleEndDay(openDay.id)}
                          disabled={busy}
                          className="ml-4 shrink-0 px-4 py-2 rounded-xl border-2 border-gray-900
                                     text-xs font-semibold text-gray-900
                                     hover:bg-gray-900 hover:text-white transition-all disabled:opacity-50"
                        >
                          End Day
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartDay(ws.id)}
                          disabled={busy}
                          className="ml-4 shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-white
                                     transition-all active:scale-[0.98] disabled:opacity-50"
                          style={{ backgroundColor: 'var(--accent)' }}
                        >
                          Start Day
                        </button>
                      )
                    )}
                  </div>
                );
              })
            )}

            {actionError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs text-red-700">{actionError}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Reports Tab ──────────────────────────────────────────────── */}
        {activeTab === 'reports' && (
          <div className="px-5 py-5 fade-in">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Reports</h2>
            <button
              onClick={() => router.push('/reports')}
              className="w-full py-4 rounded-2xl border border-gray-200 text-sm font-medium
                         text-gray-700 hover:bg-gray-50 transition-colors text-left px-5"
            >
              View all reports →
            </button>
          </div>
        )}

        {/* ── Admin Tab (ED only) ───────────────────────────────────────── */}
        {activeTab === 'admin' && isED && (
          <div className="px-5 py-5 fade-in">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Admin</h2>
            <div className="flex flex-col gap-3">
              {[
                { label: 'Manage Worksites', path: '/worksites' },
                { label: 'Manage Staff',     path: '/staff' },
                { label: 'Audit Log',        path: '/admin/audit' },
                { label: 'QBO Integration',  path: '/admin/qbo' },
              ].map(item => (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className="w-full py-4 rounded-2xl border border-gray-200 text-sm font-medium
                             text-gray-700 hover:bg-gray-50 transition-colors text-left px-5"
                >
                  {item.label} →
                </button>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* ── Bottom Nav ─────────────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md
                      bg-white border-t border-gray-100 pb-safe flex">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id as typeof activeTab);
                setActionError(null);
              }}
              className="flex-1 flex flex-col items-center py-3 gap-1 transition-colors"
              style={{ color: active ? 'var(--accent)' : '#9ca3af' }}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-wide">{label}</span>
            </button>
          );
        })}
      </nav>

    </div>
  );
}
