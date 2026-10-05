/** Trigger a browser download of a blob (shared by the planning card and the shot list). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A safe file-name stem: letters and digits of any script, dots and dashes; `fallback` when nothing is left. */
export function fileStem(name: string, fallback: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N}.-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || fallback
  );
}
