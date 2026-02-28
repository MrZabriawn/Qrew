// src/lib/theme/ThemeContext.tsx
// Unused — theme selection removed. Qrew Housing Workforce uses white + #205620 green exclusively.
// Kept as a stub to avoid import errors if referenced elsewhere.
'use client';

import { createContext, useContext, ReactNode } from 'react';
import type { AccentMode } from '@/types';

interface ThemeContextType {
  accent: AccentMode | null;
  showPicker: boolean;
  setAccent: (mode: AccentMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType>({
  accent: 'green',
  showPicker: false,
  setAccent: async () => {},
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ accent: 'green', showPicker: false, setAccent: async () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}
