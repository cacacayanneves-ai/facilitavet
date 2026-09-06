import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Facilita Vet — planejamento inteligente de visitas',
    template: '%s · Facilita Vet',
  },
  description:
    'Transforme sua carteira de clínicas veterinárias em um planejamento mensal com rotas otimizadas, agenda diária e roteiro no WhatsApp.',
  applicationName: 'Facilita Vet',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0f3d35',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://rsms.me" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%23256b5e' d='M16 2.5c-5.1 0-9.2 4.1-9.2 9.2 0 6.4 8.1 15 8.4 15.4a1 1 0 0 0 1.5 0c.3-.4 8.4-9 8.4-15.4 0-5.1-4.1-9.2-9.1-9.2Z'/%3E%3Cg fill='white'%3E%3Cellipse cx='12.5' cy='9.6' rx='1.35' ry='1.75'/%3E%3Cellipse cx='16' cy='8.6' rx='1.35' ry='1.85'/%3E%3Cellipse cx='19.5' cy='9.6' rx='1.35' ry='1.75'/%3E%3Cpath d='M16 12.1c2.6 0 4.3 1.7 4.3 3.5s-1.9 2.4-4.3 2.4-4.3-.6-4.3-2.4 1.7-3.5 4.3-3.5Z'/%3E%3C/g%3E%3C/svg%3E"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
