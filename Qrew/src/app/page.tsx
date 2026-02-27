// src/app/page.tsx
'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useEffect, useState } from 'react';

export default function HomePage() {
  const { user, signIn, loading } = useAuth();
  const [mounted, setMounted]         = useState(false);
  const [signingIn, setSigningIn]     = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && !loading && user) {
      window.location.href = '/dashboard';
    }
  }, [mounted, loading, user]);

  if (!mounted || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex flex-col">

        {/* Top brand strip */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
          <div>
            <p className="text-[8px] tracking-[0.4em] uppercase text-gray-400 font-mono">
              Elder Systems
            </p>
            <p className="text-[11px] font-bold tracking-[0.25em] uppercase font-mono"
               style={{ color: 'var(--accent)' }}>
              Housing Workforce
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[8px] text-gray-400 font-mono uppercase tracking-widest hidden sm:inline">
              Online
            </span>
          </div>
        </div>

        {/* Centered content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 fade-in">
          <div className="w-full max-w-[320px]">

            {/* Logo */}
            <div className="flex justify-center mb-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hoi-logo.png"
                alt="Housing Opportunities Inc."
                className="h-28 w-auto object-contain"
              />
            </div>

            {/* Heading */}
            <div className="text-center mb-8">
              <h1 className="text-xl font-semibold text-gray-900 tracking-tight">
                Staff Time Clock
              </h1>
              <p className="text-sm text-gray-400 mt-1">Sign in with your work account</p>
            </div>

            {/* Sign-in button */}
            <button
              onClick={async () => {
                setSignInError(null);
                setSigningIn(true);
                try { await signIn(); }
                catch (err: unknown) {
                  setSignInError(err instanceof Error ? err.message : String(err));
                } finally { setSigningIn(false); }
              }}
              disabled={signingIn}
              className="w-full py-4 rounded-2xl text-white text-sm font-semibold
                         flex items-center justify-center gap-3
                         transition-all active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {signingIn ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              {signingIn ? 'Signing in…' : 'Continue with Google'}
            </button>

            {signInError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs text-red-700">{signInError}</p>
              </div>
            )}

            <p className="text-center text-[10px] text-gray-400 mt-5">
              housingopportunities.org accounts only
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 text-center">
          <p className="text-[9px] text-gray-300 font-mono tracking-widest uppercase">
            Qrew · Elder Systems
          </p>
        </div>

      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="spinner" />
    </div>
  );
}
