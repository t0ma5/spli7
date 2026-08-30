import { getGroupForExport } from '@/lib/api'
import { assertExportAccess } from '@/lib/group-access'
import contentDisposition from 'content-disposition'
import { NextResponse } from 'next/server'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params
  if (!(await assertExportAccess(req, groupId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const group = await getGroupForExport(groupId)
  if (!group)
    return NextResponse.json({ error: 'Invalid group ID' }, { status: 404 })

  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Export - ${date}`
  return NextResponse.json(group, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': contentDisposition(`${filename}.json`),
    },
  })
}
