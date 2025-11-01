import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'LLM Bias Scope',
  description: 'Compare LLM outputs via Vercel AI Gateway',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--textPrimary)] antialiased">
        {children}
      </body>
    </html>
  );
}
