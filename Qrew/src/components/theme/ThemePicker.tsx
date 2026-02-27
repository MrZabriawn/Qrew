// src/components/theme/ThemePicker.tsx
// Full-screen modal that appears on first login to let the user choose their accent color.
// The choice is persisted to Firestore and applies immediately via CSS custom properties.
// Once chosen it never appears again unless the user resets from Settings.
'use client';

import { useState } from 'react';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { AccentMode } from '@/types';

// Preview swatches shown to the user before they commit a choice
const MODES: {
  mode: AccentMode;
  label: string;
  accent: string;          // literal hex for the preview swatch (can't use var(--accent) here)
  logo: string;            // path relative to /public
  tagline: string;
}[] = [
  {
    mode: 'blue',
    label: 'Blue Mode',
    accent: '#2323F1',
    logo: '/hoi-logo.png',
    tagline: 'Electric · Standard · Sharp',
  },
  {
    mode: 'green',
    label: 'Green Mode',
    accent: '#205620',
    logo: '/hoi-logo-green.png',
    tagline: 'Grounded · Field · Natural',
  },
];

export function ThemePicker() {
  const { setAccent } = useTheme();
  const [hoveredMode, setHoveredMode] = useState<AccentMode | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (mode: AccentMode) => {
    if (saving) return;
    setSaving(true);
    await setAccent(mode);
    // setAccent dismisses the picker by setting showPicker=false in ThemeContext
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center fade-in"
      style={{ backgroundColor: 'var(--dark-base)' }}
    >
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-[9px] tracking-[0.4em] uppercase font-mono mb-1"
           style={{ color: 'var(--text-muted)' }}>
          Elder Systems · Qrew
        </p>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase font-mono text-white">
          Choose Your Interface Mode
        </h1>
        <p className="mt-2 text-[10px] tracking-[0.15em] uppercase font-mono"
           style={{ color: 'var(--text-muted)' }}>
          This preference is saved to your account
        </p>
      </div>

      {/* Mode cards */}
      <div className="flex gap-0 w-full max-w-sm">
        {MODES.map(({ mode, label, accent, logo, tagline }) => {
          const isHovered = hoveredMode === mode;
          return (
            <button
              key={mode}
              disabled={saving}
              onClick={() => handleSelect(mode)}
              onMouseEnter={() => setHoveredMode(mode)}
              onMouseLeave={() => setHoveredMode(null)}
              className="flex-1 flex flex-col items-center py-8 px-4 transition-all duration-150
                         focus:outline-none disabled:opacity-50"
              style={{
                backgroundColor: isHovered ? 'var(--dark-elevated)' : 'var(--dark-surface)',
                border: `1px solid ${isHovered ? accent : 'var(--dark-border)'}`,
              }}
            >
              {/* Logo */}
              <div
                className="w-20 h-20 mb-5 flex items-center justify-center p-3"
                style={{
                  border: `1px solid ${isHovered ? accent : 'var(--dark-border)'}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt={label} className="w-full h-auto object-contain" />
              </div>

              {/* Accent swatch */}
              <div
                className="w-6 h-1 mb-4"
                style={{ backgroundColor: accent }}
              />

              {/* Labels */}
              <p className="text-[10px] font-bold tracking-[0.25em] uppercase font-mono text-white mb-1">
                {label}
              </p>
              <p className="text-[8px] tracking-[0.15em] uppercase font-mono"
                 style={{ color: 'var(--text-muted)' }}>
                {tagline}
              </p>
            </button>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="mt-8 text-[8px] tracking-[0.2em] uppercase font-mono"
         style={{ color: 'var(--dark-border)' }}>
        Changeable in settings
      </p>

      {saving && (
        <div className="mt-6">
          <div className="spinner" />
        </div>
      )}
    </div>
  );
}
