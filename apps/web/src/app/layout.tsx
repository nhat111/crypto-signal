import type { Metadata } from 'next';
import './globals.css';
import { NavBar } from '@/components/layout/NavBar';

export const metadata: Metadata = {
  title: 'Market Health Monitor',
  description: 'Is the rally backed by real spot demand, or just leverage?',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        <NavBar />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
