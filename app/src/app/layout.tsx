import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'LLM Bias Scope',
  description: 'Compare LLM outputs via Vercel AI Gateway',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900">
      <body className="min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
