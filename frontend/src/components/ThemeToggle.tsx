import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * ThemeToggle Component
 * Displays theme toggle button (light/dark mode)
 */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`
        relative inline-flex items-center justify-center
        p-2 rounded-lg
        transition-all duration-300
        ${theme === 'dark' 
          ? 'bg-slate-800 hover:bg-slate-700 text-yellow-400' 
          : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
        }
        focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
        ${theme === 'dark' ? 'focus:ring-offset-slate-900' : 'focus:ring-offset-white'}
        ${className}
      `}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <Sun size={18} className="animate-pulse" />
      ) : (
        <Moon size={18} className="animate-pulse" />
      )}
    </button>
  );
};

/**
 * ThemeSelector Component
 * Dropdown menu for theme selection
 */
export const ThemeSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`flex gap-2 items-center ${className}`}>
      <button
        onClick={() => setTheme('light')}
        className={`
          p-2 rounded-lg transition-all
          ${theme === 'light'
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
          }
        `}
        title="Light mode"
        aria-label="Light mode"
      >
        <Sun size={16} />
      </button>
      <button
        onClick={() => setTheme('dark')}
        className={`
          p-2 rounded-lg transition-all
          ${theme === 'dark'
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
          }
        `}
        title="Dark mode"
        aria-label="Dark mode"
      >
        <Moon size={16} />
      </button>
    </div>
  );
};

/**
 * ThemeMenuItem Component
 * A row matching this app's account-dropdown menu items (icon + label,
 * left-aligned, full width) — drop into any "My Profile" / "Sign Out" style
 * menu so every dashboard's account menu gets the same dark/light toggle
 * instead of re-implementing the switch per page.
 */
export const ThemeMenuItem: React.FC<{ className?: string; onClick?: () => void }> = ({ className = '', onClick }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={() => {
        toggleTheme();
        onClick?.();
      }}
      className={`w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 ${className}`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      <span className="text-sm font-medium">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
    </button>
  );
};

export default ThemeToggle;
