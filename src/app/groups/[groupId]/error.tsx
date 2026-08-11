'use client'

export default function GroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="py-10 text-center space-y-4">
      <h2 className="text-xl font-semibold">Couldn’t load this group</h2>
      <p className="text-muted-foreground text-sm">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <button
        type="button"
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  )
}
