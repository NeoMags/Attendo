import { DOC_MAX_BYTES } from '@/lib/identity'

/** Downscale a photo/ID image to at most `maxSide` px and re-encode as JPEG so uploads stay well under the 2 MB limit. PDFs pass through unchanged. */
export async function prepareUpload(file: File, maxSide = 1280): Promise<{ blob: Blob; mime: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > DOC_MAX_BYTES) throw new Error('PDF is larger than 2 MB. Use a smaller file or a photo.')
    return { blob: file, mime: 'application/pdf' }
  }
  if (!file.type.startsWith('image/')) throw new Error('Choose an image (JPG, PNG, WebP) or a PDF.')
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  for (const q of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= DOC_MAX_BYTES) return { blob, mime: 'image/jpeg' }
  }
  throw new Error('Image is too large even after compression.')
}
