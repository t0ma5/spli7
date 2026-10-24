'use client'
import { useEffect, useState } from 'react'

/**
 * A PNG data URL of `text` as a QR code, or null while it renders. The qrcode
 * package is loaded on demand so pages without a QR code do not ship it.
 */
export function useQrDataUrl(
  text: string | null | undefined,
  options: {
    width?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  } = {},
): string | null {
  const { width = 180, errorCorrectionLevel = 'M' } = options
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!text) {
      setDataUrl(null)
      return
    }
    let cancelled = false
    void import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [text, width, errorCorrectionLevel])

  return dataUrl
}
