'use client';

import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
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

/** Signed-in user's initial, with a sign-out action. */
export function UserMenu() {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabase) return;
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, [supabase]);

  if (!hasSupabase || !email) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Account" />}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {email[0]?.toUpperCase()}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* A plain div, NOT DropdownMenuLabel: that maps to Base UI's
            GroupLabel, which throws "MenuGroupContext is missing" unless it is
            wrapped in a <Menu.Group>. The thrown error takes down the whole
            page, not just the menu. */}
        <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">{email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await supabase.auth.signOut();
            // Full page load so the server re-reads the now-cleared session
            // cookie; a client transition can render a stale signed-in view.
            window.location.assign('/login');
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
