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
      allowedOrigins: ['localhost:3000'],
    },
  },
}

export default withNextIntl(nextConfig)

initOpenNextCloudflareForDev()
