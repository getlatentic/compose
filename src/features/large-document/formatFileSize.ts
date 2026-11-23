const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** A file's size as a person reads it: `1.2 GB`, `640 KB`. */
export function formatFileSize(bytes: number): string {
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${UNITS[unit]}`;
}
