'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NAV, APP_NAME } from './nav';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
            }`}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Page frame: fixed sidebar on desktop, slide-out on mobile.
 * Wrap page content in this. The `title` shows in the header bar.
 *
 * `sidebarExtra` fills the space under the nav links — the agent page passes
 * its conversation list there so past chats are always visible rather than
 * buried behind an icon.
 */
export function AppShell({
  title,
  children,
  sidebarExtra,
}: {
  title?: string;
  children: React.ReactNode;
  sidebarExtra?: React.ReactNode;
}) {
  const sidebarBody = (onNavigate?: () => void) => (
    <>
      <NavLinks onNavigate={onNavigate} />
      {sidebarExtra ? (
        <>
          <div className="mx-3 border-t" />
          <div className="flex min-h-0 flex-1 flex-col pt-3">{sidebarExtra}</div>
        </>
      ) : null}
    </>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 shrink-0 items-center border-b px-5 font-semibold tracking-tight">
          {APP_NAME}
        </div>
        {sidebarBody()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-5">
          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" />
              }
            >
              <Menu className="size-4" />
            </SheetTrigger>
            <SheetContent side="left" className="flex w-64 flex-col p-0">
              <SheetTitle className="flex h-14 shrink-0 items-center border-b px-5 text-base font-semibold">
                {APP_NAME}
              </SheetTitle>
              {sidebarBody()}
            </SheetContent>
          </Sheet>

          <h1 className="truncate text-sm font-medium">{title}</h1>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
