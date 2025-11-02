import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'LLM Bias Scope',
  description: 'Compare LLM outputs and their biases side-by-side',
  icons: {
    icon: '/favicon.ico',          // standard browser favicon
    shortcut: '/favicon.ico'      // fallback for older browsers
  },
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
