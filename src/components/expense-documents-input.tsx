import { ExpenseFormValues } from '@/lib/schemas'

type Props = {
  documents: ExpenseFormValues['documents']
  updateDocuments: (documents: ExpenseFormValues['documents']) => void
}

/**
 * Document uploads are deferred on the Cloudflare KV deploy.
 * Component kept so expense forms compile when the feature flag is off.
 */
export function ExpenseDocumentsInput(_props: Props) {
  return (
    <p className="text-sm text-muted-foreground">
      Expense document uploads are not available on this deployment.
    </p>
  )
}

export function DocumentThumbnail(_props: {
  document: ExpenseFormValues['documents'][number]
  documents: ExpenseFormValues['documents']
  deleteDocument: (document: ExpenseFormValues['documents'][number]) => void
}) {
  return null
}
