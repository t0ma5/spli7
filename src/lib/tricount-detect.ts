export function looksLikeTricountCsv(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  return (
    firstLine.includes('Title') &&
    firstLine.includes('Amount') &&
    firstLine.includes('Paid by') &&
    (firstLine.includes('Impacted to ') || firstLine.includes('Currency'))
  )
}
