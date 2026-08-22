import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { NotificationProvider } from '@/components/providers/notifications';
import { Toaster } from '@/components/ui/sonner';
import { APP_NAME } from '@/components/layout/nav';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — the safer walk home`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Which paths students actually walk after dark, how likely each one is to be unlit, and which repairs remove the most risk. Manipal University Jaipur.',
  // src/app/icon.png is picked up automatically as the favicon.
  openGraph: {
    title: `${APP_NAME} — the safer walk home`,
    description: 'Night-time pedestrian safety, computed rather than complained about.',
    images: ['/logo.png'],
  },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          <NotificationProvider>
            {children}
            <Toaster position="top-right" />
          </NotificationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
