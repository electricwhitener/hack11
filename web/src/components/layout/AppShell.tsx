'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { NAV, APP_NAME } from './nav';
import { UserMenu } from './UserMenu';

/**
 * Page frame: one slim header, everything else is content.
 *
 * There is no persistent sidebar. With only two destinations it was spending
 * 256px to show two links, and on the map — which is the product — that space
 * matters more than the navigation does. Settings, theme and notifications all
 * moved into the account menu, where people look for them anyway.
 *
 * `bleed` gives a page the full viewport under the header with no scrolling,
 * which is what the map needs; ordinary pages scroll normally.
 */
export function AppShell({
  title,
  children,
  bleed = false,
}: {
  title?: string;
  children: React.ReactNode;
  bleed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 md:px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {/* The mark carries the warm palette on its own, so it needs no tint. */}
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            priority
            className="size-7 rounded-[7px] shadow-sm ring-1 ring-white/10"
          />
          <span className="hidden sm:inline">{APP_NAME}</span>
        </Link>

        <nav className="ml-2 flex items-center gap-1 md:ml-6">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors md:px-3 ${
                  active
                    ? 'bg-secondary font-medium text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        {title ? (
          <span className="ml-auto hidden truncate text-xs text-muted-foreground lg:block">
            {title}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1 lg:ml-4">
          <UserMenu />
        </div>
      </header>

      <main className={bleed ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto'}>
        {children}
      </main>
    </div>
  );
}
