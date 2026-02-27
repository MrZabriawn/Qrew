// src/lib/theme/ThemeContext.tsx
// Manages the user's accent color preference (blue or green mode).
//
// Architecture:
//   - The selected accent is stored in the user's Firestore document (users/{uid}.accentMode).
//   - On mount, ThemeProvider reads the preference and applies data-accent to <html>.
//   - When accentMode is undefined (first login), ThemeProvider sets showPicker=true so
//     the ThemePicker overlay can render. All downstream pages receive null for accent
//     until the pick is confirmed.
//   - Color resolution is purely via CSS custom properties (--accent in globals.css).
//     No JavaScript color values are passed to components — they use var(--accent) directly.
'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import type { AccentMode } from '@/types';

interface ThemeContextType {
  accent: AccentMode | null;      // null = not yet resolved (picker is showing)
  showPicker: boolean;            // true = first-login picker is visible
  setAccent: (mode: AccentMode) => Promise<void>; // persists to Firestore + applies immediately
}

const ThemeContext = createContext<ThemeContextType>({
  accent: 'blue',
  showPicker: false,
  setAccent: async () => {},
});

export const useTheme = () => useContext(ThemeContext);

// Applies the accent to the <html> element so [data-accent="green"] CSS selectors fire.
function applyAccent(mode: AccentMode) {
  document.documentElement.setAttribute('data-accent', mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [accent, setAccentState] = useState<AccentMode | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // Once auth resolves, read accentMode from the user document.
  // Apply immediately so there's no flash of wrong theme.
  useEffect(() => {
    if (loading) return;

    if (!user) {
      // Logged-out state — apply default blue so the login page looks correct
      applyAccent('blue');
      setAccentState('blue');
      setShowPicker(false);
      return;
    }

    if (user.accentMode) {
      applyAccent(user.accentMode);
      setAccentState(user.accentMode);
      setShowPicker(false);
    } else {
      // First login — show the picker. Keep blue applied so the overlay itself renders correctly.
      applyAccent('blue');
      setAccentState(null);
      setShowPicker(true);
    }
  }, [user, loading]);

  // Persists the chosen accent to Firestore, updates local state, and applies the CSS attribute.
  const setAccent = useCallback(async (mode: AccentMode) => {
    if (!user) return;

    // Apply immediately so the UI responds without waiting for Firestore
    applyAccent(mode);
    setAccentState(mode);
    setShowPicker(false);

    await updateDoc(doc(db, 'users', user.id), { accentMode: mode });
  }, [user]);

  return (
    <ThemeContext.Provider value={{ accent, showPicker, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}
