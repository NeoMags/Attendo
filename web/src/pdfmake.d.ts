declare module 'pdfmake/build/pdfmake' {
  const pdfMake: {
    addVirtualFileSystem(vfs: Record<string, string>): void
    addFonts(fonts: Record<string, { normal: string; bold?: string }>): void
    createPdf(def: unknown): { getBlob(): Promise<Blob>; getBuffer(): Promise<Uint8Array> }
  }
  export default pdfMake
}
