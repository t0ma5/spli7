import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import createNextIntlPlugin from 'next-intl/plugin'

// Relative path required for next-intl with Turbopack
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        'spl1t.pages.dev',
        'spl1t.contti.workers.dev',
      ],
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)

initOpenNextCloudflareForDev()
