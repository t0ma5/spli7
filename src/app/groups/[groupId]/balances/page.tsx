import BalancesAndReimbursements from '@/app/groups/[groupId]/balances/balances-and-reimbursements'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Balance',
}

export default async function GroupPage() {
  return <BalancesAndReimbursements />
}
