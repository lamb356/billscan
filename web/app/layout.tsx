import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: {
    default: 'BillScan — Medical Bill Auditor',
    template: '%s | BillScan',
  },
  description:
    'Audit your medical bill against 1M+ CMS Medicare rates. Find overcharges instantly with real government data.',
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'https://billscan.app'),
  openGraph: {
    type: 'website',
    siteName: 'BillScan',
    title: 'BillScan — Medical Bill Auditor',
    description: 'Your medical bills are probably wrong. BillScan audits them against 1M+ CMS rates.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BillScan — Medical Bill Auditor',
    description: 'Audit your medical bill against real CMS.gov Medicare rates.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
