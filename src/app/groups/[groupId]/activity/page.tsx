import { ActivityPageClient } from '@/app/groups/[groupId]/activity/page.client'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'History',
}

export default async function ActivityPage() {
  return <ActivityPageClient />
}
