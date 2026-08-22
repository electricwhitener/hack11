'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { LogOut, LogIn, Moon, Sun, Monitor, Bell, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createClient } from '@/lib/supabase/client';
import { hasSupabase } from '@/lib/supabase/config';
import { useNotifications } from '@/components/providers/notifications';

/**
 * One menu for everything personal: theme, notifications, sign-out.
 *
 * These used to be three separate header icons competing with the product.
 * People look for preferences under their account, so that is where they live.
 */
export function UserMenu() {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { items, unread, clear } = useNotifications();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!hasSupabase) return;
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, [supabase]);

  const count = items.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Account and settings" />}>
        <span className="relative flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {email ? email[0]?.toUpperCase() : <User className="size-3.5" />}
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card bg-destructive" />
          ) : null}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {/* A plain div, NOT DropdownMenuLabel: that maps to Base UI's
            GroupLabel, which throws "MenuGroupContext is missing" unless it is
            wrapped in a <Menu.Group>. The throw takes down the whole page. */}
        <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">
          {email ?? 'Not signed in'}
        </div>
        <DropdownMenuSeparator />

        <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">Theme</div>
        <div className="flex gap-1 px-2 pb-2">
          {(
            [
              ['light', Sun, 'Light'],
              ['dark', Moon, 'Dark'],
              ['system', Monitor, 'System'],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              size="sm"
              variant={mounted && theme === value ? 'default' : 'outline'}
              className="h-7 flex-1 px-0"
              onClick={() => setTheme(value)}
              aria-label={label}
              title={label}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={clear} disabled={count === 0}>
          <Bell className="size-4" />
          {count > 0 ? `Clear ${count} notification${count > 1 ? 's' : ''}` : 'No notifications'}
        </DropdownMenuItem>

        {hasSupabase ? (
          <>
            <DropdownMenuSeparator />
            {email ? (
              <DropdownMenuItem
                onClick={async () => {
                  await supabase.auth.signOut();
                  // Full page load so the server re-reads the cleared session
                  // cookie; a client transition can render a stale signed-in view.
                  window.location.assign('/');
                }}
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            ) : (
              <>
                {/* Signing in is optional — everything works without it. The
                    only thing it buys is conversations that survive a reload,
                    so say that rather than implying a wall. */}
                <div className="px-2 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Everything works signed out. Sign in only to keep your
                  conversations.
                </div>
                <DropdownMenuItem onClick={() => window.location.assign('/login')}>
                  <LogIn className="size-4" />
                  Sign in
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
