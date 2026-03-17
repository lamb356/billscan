/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  serverExternalPackages: ['@libsql/client', 'blake3', 'pdf-parse', 'tesseract.js'],
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
