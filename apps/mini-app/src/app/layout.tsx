import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';
import './product-shell.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TelegramProvider } from '@/components/TelegramProvider';
import RouteProviders from '@/components/RouteProviders';
import { LocaleProvider } from '@/lib/i18n';
import { SHELL_INITIALIZER } from './shellInitializer';
import { BRAND_DESCRIPTION, BRAND_TITLE, DEFAULT_ROBOTS, pageMetadata } from './routeMetadata';

// The complete interface is English. Keep its licensed variable Inter font
// local so every production build emits the same bytes without a font API.
const inter = localFont({ src: './fonts/inter-latin.woff2', weight: '100 900', style: 'normal', display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  metadataBase: new URL('https://fxaeon.com'),
  ...pageMetadata(BRAND_TITLE, BRAND_DESCRIPTION, '/'),
  // This host serves the interactive wallet app. Searchable editorial content
  // opts in from /docs; wallet, invitation, and approval routes inherit noindex.
  robots: DEFAULT_ROBOTS,
  title: { default: BRAND_TITLE, template: '%s · FxAeon' },
  applicationName: 'FxAeon',
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'FxAeon' },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#080808',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SHELL_INITIALIZER }} />
        {/* Same-origin, pinned official bridge: initialize launch parameters
            before hydration without depending on telegram.org reachability. */}
        <Script
          src="/vendor/telegram/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={inter.className}>
        <ErrorBoundary>
          <LocaleProvider>
            <TelegramProvider><RouteProviders>{children}</RouteProviders></TelegramProvider>
          </LocaleProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
