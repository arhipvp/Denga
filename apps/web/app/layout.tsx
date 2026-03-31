import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Denga',
  description: 'Family finance tracker admin panel',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
