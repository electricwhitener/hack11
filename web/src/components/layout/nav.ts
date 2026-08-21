import { Map, ListOrdered, type LucideIcon } from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Two places, because there are only two things to do: look at the map, or work
 * the repair list. The agent is not a destination — it lives on the map, where
 * the questions actually come up.
 */
export const NAV: NavItem[] = [
  { href: '/', label: 'Dark-zone map', icon: Map },
  { href: '/queue', label: 'Repair queue', icon: ListOrdered },
];

export const APP_NAME = 'Nightline';
