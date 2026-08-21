import { AppShell } from '@/components/layout/AppShell';
import { Chat } from '@/components/Chat';

export default function Home() {
  return (
    <AppShell title="Agent">
      <Chat />
    </AppShell>
  );
}
