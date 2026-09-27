import type { Metadata } from 'next';
import { EDUCATIONAL_NOTICE } from '@lvd/shared';
import './globals.css';

export const metadata: Metadata = {
  title: 'University Test Service',
  description: 'Controlled observation page for the Local Virtual Desktop research study.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner" role="note">{EDUCATIONAL_NOTICE}</div>
        {children}
      </body>
    </html>
  );
}
