'use client'
import { Button } from '@/components/ui/button'
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { ExpenseFormValues } from '@/lib/schemas'
import { formatFileSize } from '@/lib/utils'
import { ImagePlus, Loader2, Trash, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

type Document = ExpenseFormValues['documents'][number]

type Props = {
  groupId: string
  documents: ExpenseFormValues['documents']
  updateDocuments: (documents: ExpenseFormValues['documents']) => void
}

/** Larger photos are scaled down in the browser before upload. */
const MAX_EDGE = 2000
/** What the user may pick; the upload itself is the resized JPEG. */
const MAX_SOURCE_SIZE = 25 * 1024 ** 2
/** Matches the server's limit (below Vercel's 4.5 MB request cap). */
const MAX_UPLOAD_SIZE = 4 * 1024 ** 2

async function resizeImage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    // White behind transparent PNGs, which JPEG cannot keep.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    )
    if (!blob) throw new Error('Could not encode the image')
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}

export function ExpenseDocumentsInput({
  groupId,
  documents,
  updateDocuments,
}: Props) {
  const locale = useLocale()
  const t = useTranslations('ExpenseDocumentsInput')
  const [pending, setPending] = useState(false)
  const [online, setOnline] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  // Uploads run while the form may change; always append to the latest list.
  const documentsRef = useRef(documents)
  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const upload = async (file: File) => {
    try {
      setPending(true)
      const { blob, width, height } = await resizeImage(file)
      if (blob.size > MAX_UPLOAD_SIZE) throw new Error('Image still too large')
      const body = new FormData()
      body.set('file', blob, 'receipt.jpg')
      body.set('width', String(width))
      body.set('height', String(height))
      const response = await fetch(`/api/groups/${groupId}/documents`, {
        method: 'POST',
        body,
      })
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      const document = (await response.json()) as Document
      updateDocuments([...documentsRef.current, document])
    } catch (error) {
      console.error(error)
      toast({
        title: t('ErrorToast.title'),
        description: t('ErrorToast.description'),
        variant: 'destructive',
        action: (
          <ToastAction
            altText={t('ErrorToast.retry')}
            onClick={() => upload(file)}
          >
            {t('ErrorToast.retry')}
          </ToastAction>
        ),
      })
    } finally {
      setPending(false)
    }
  }

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_SOURCE_SIZE) {
      toast({
        title: t('TooBigToast.title'),
        description: t('TooBigToast.description', {
          maxSize: formatFileSize(MAX_SOURCE_SIZE, locale),
          size: formatFileSize(file.size, locale),
        }),
        variant: 'destructive',
      })
      return
    }
    void upload(file)
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          handleFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 [&>*]:aspect-square">
        {documents.map((doc) => (
          <DocumentThumbnail
            key={doc.id}
            document={doc}
            documents={documents}
            deleteDocument={(document) => {
              updateDocuments(documents.filter((d) => d.id !== document.id))
            }}
          />
        ))}
        <Button
          variant="secondary"
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-full flex-col gap-2"
          disabled={pending || !online}
          aria-label={t('add')}
        >
          {pending ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : (
            <ImagePlus className="w-8 h-8" />
          )}
          <span className="text-xs text-muted-foreground whitespace-normal">
            {online ? t('add') : t('offline')}
          </span>
        </Button>
      </div>
    </div>
  )
}

export function DocumentThumbnail({
  document,
  documents,
  deleteDocument,
}: {
  document: Document
  documents: ExpenseFormValues['documents']
  deleteDocument: (document: Document) => void
}) {
  const t = useTranslations('ExpenseDocumentsInput')
  const [open, setOpen] = useState(false)
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(documents.indexOf(document))

  useEffect(() => {
    if (!api) return
    const onSelect = () => setCurrent(api.selectedScrollSnap())
    api.on('select', onSelect)
    return () => {
      api.off('select', onSelect)
    }
  }, [api])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="w-full h-full p-0 border overflow-hidden rounded shadow-inner"
          aria-label={t('open')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- private, same-origin route; no optimizer */}
          <img
            className="w-full h-full object-cover"
            src={document.url}
            alt=""
            loading="lazy"
          />
        </Button>
      </DialogTrigger>
      <DialogContent className="p-4 w-[100vw] max-w-[100vw] h-[100dvh] max-h-[100dvh] sm:max-w-[calc(100vw-32px)] sm:max-h-[calc(100dvh-32px)] [&>:last-child]:hidden">
        <DialogTitle className="sr-only">{t('viewerTitle')}</DialogTitle>
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                const target = documents[current]
                if (target) deleteDocument(target)
                setOpen(false)
              }}
            >
              <Trash className="w-4 h-4 mr-2" />
              {t('delete')}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                <X className="w-4 h-4 mr-2" /> {t('close')}
              </Button>
            </DialogClose>
          </div>
          <Carousel
            opts={{
              startIndex: documents.indexOf(document),
              loop: true,
              align: 'center',
            }}
            setApi={setApi}
          >
            <CarouselContent>
              {documents.map((doc) => (
                <CarouselItem key={doc.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img
                    className="object-contain w-[calc(100vw-32px)] h-[calc(100dvh-32px-40px-16px-48px)] sm:w-[calc(100vw-32px-32px)] sm:h-[calc(100dvh-32px-40px-16px-32px-48px)]"
                    src={doc.url}
                    width={doc.width}
                    height={doc.height}
                    alt=""
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious
              type="button"
              className="left-0 top-auto -bottom-16"
            />
            <CarouselNext
              type="button"
              className="right-0 top-auto -bottom-16"
            />
          </Carousel>
        </div>
      </DialogContent>
    </Dialog>
  )
}
