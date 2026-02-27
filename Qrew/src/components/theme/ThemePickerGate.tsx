// src/components/theme/ThemePickerGate.tsx
// Sits between ThemeProvider and page children.
// When the user hasn't chosen an accent yet (first login), renders the ThemePicker
// full-screen overlay instead of — not on top of — the page content. This prevents
// the dashboard from mounting and firing data fetches before the preference is saved.
'use client';

import { ReactNode } from 'react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { ThemePicker } from './ThemePicker';
import { useAuth } from '@/components/auth/AuthProvider';

export function ThemePickerGate({ children }: { children: ReactNode }) {
  const { showPicker } = useTheme();
  const { loading } = useAuth();

  // While auth is still resolving, render nothing — AuthProvider/page handles the spinner
  if (loading) return <>{children}</>;

  // Block the app until the user picks a mode
  if (showPicker) return <ThemePicker />;

  return <>{children}</>;
}
