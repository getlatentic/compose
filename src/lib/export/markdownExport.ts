export interface MarkdownExportRequest {
  filePath: string;
  markdown: string;
}

export function markdownExportFileName(filePath: string) {
  const fallbackName = "untitled.md";
  const leafName = filePath.split(/[\\/]/).filter(Boolean).pop()?.trim();
  if (!leafName) {
    return fallbackName;
  }

  const safeName = leafName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  return safeName.endsWith(".md") ? safeName : `${safeName}.md`;
}

export function exportMarkdownFile({ filePath, markdown }: MarkdownExportRequest) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = markdownExportFileName(filePath);
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
