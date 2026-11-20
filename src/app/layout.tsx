import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { NavigationProgress } from '@/components/shell/navigation-progress';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = { title: { default: 'Workline', template: '%s · Workline' }, description: 'Work commitments, accountability and product progress for small teams.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NavigationProgress />
          {children}
          <Toaster position="bottom-right" toastOptions={{ style: { background: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--border)', fontSize: 13 } }} />
        </ThemeProvider>
      </body>
    </html>);
}
