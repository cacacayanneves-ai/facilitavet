/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['exceljs', 'bcryptjs'],
  experimental: {
    // Route generation can be heavy; keep server actions payload generous for imports.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
