import { Bot, LayoutDashboard, Database, Settings, type LucideIcon } from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Edit this one array to change the sidebar. Add a route file at the matching
 * path under src/app/ and it appears automatically.
 */
export const NAV: NavItem[] = [
  { href: '/', label: 'Agent', icon: Bot },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/data', label: 'Data', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Shown in the sidebar header and the browser tab. Rename at kickoff. */
export const APP_NAME = 'Untitled';
