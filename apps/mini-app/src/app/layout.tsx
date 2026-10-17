import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import './product-shell.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TelegramProvider } from '@/components/TelegramProvider';
import WalletProviderBoundary from '@/components/WalletProviderBoundary';
import RoutePriceProvider from '@/components/RoutePriceProvider';
import { LocaleProvider } from '@/lib/i18n';
import { SHELL_INITIALIZER } from './shellInitializer';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  metadataBase: new URL('https://fxaeon.com'),
  title: {
    default: 'FxAeon',
    template: '%s · FxAeon',
  },
  description: 'Trade, borrow, earn, and bridge with the f(x) SDK from the web or Telegram.',
  openGraph: {
    type: 'website',
    siteName: 'FxAeon',
    title: 'FxAeon · Your DeFi. All in one place.',
    description: 'Trade, borrow, earn, and bridge with the f(x) SDK from the web or Telegram.',
    images: [{
      url: '/landing/fxaeon-banner.png',
      width: 2172,
      height: 724,
      alt: 'FxAeon — Your DeFi. All in one place.',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FxAeon · Your DeFi. All in one place.',
    description: 'Trade, borrow, earn, and bridge with the f(x) SDK from the web or Telegram.',
    images: ['/landing/fxaeon-banner.png'],
  },
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
  themeColor: '#101214',
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
        {/* Telegram requires its host bridge in <head> before application
            scripts. It remains a progressive enhancement: a failed request
            never blocks FxAeon's browser-compatible routes or login. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </head>
      <body className={inter.className}>
        <ErrorBoundary>
          <LocaleProvider>
            <RoutePriceProvider>
              <WalletProviderBoundary>
                <TelegramProvider>{children}</TelegramProvider>
              </WalletProviderBoundary>
            </RoutePriceProvider>
          </LocaleProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
