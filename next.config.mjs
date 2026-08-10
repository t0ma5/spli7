import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import createNextIntlPlugin from 'next-intl/plugin'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const requestConfigPath = path.join(__dirname, 'src', 'i18n', 'request.ts')

const withNextIntl = createNextIntlPlugin(requestConfigPath)

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
