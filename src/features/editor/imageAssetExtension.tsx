import { Image } from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { resolveDisplaySrc, type ImageResolveContext } from "./imageSrcResolver";

export interface ImageAssetOptions {
  // Inherited from the base `Image` extension (optional here so spreading the
  // parent options in `addOptions` type-checks; the parent supplies them at
  // runtime).
  inline?: boolean;
  allowBase64?: boolean;
  HTMLAttributes?: Record<string, unknown>;
  /**
   * Reads the freshest resolve context. A getter (closure over the editor's
   * ref) rather than a value, because the editor is configured once but the
   * active file — and therefore the directory relative refs resolve against —
   * changes over the editor's lifetime.
   */
  getContext: () => ImageResolveContext;
}

function ImageAssetNodeView({ node, extension, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as {
    src?: string | null;
    alt?: string | null;
    title?: string | null;
  };
  const options = extension.options as ImageAssetOptions;
  const displaySrc = resolveDisplaySrc(attrs.src ?? "", options.getContext());
  return (
    <NodeViewWrapper
      as={options.inline ? "span" : "div"}
      className="bob-tiptap-image"
      data-selected={selected ? "true" : undefined}
    >
      <img
        src={displaySrc}
        alt={attrs.alt ?? ""}
        title={attrs.title ?? undefined}
        // The portable, workspace-relative reference stays inspectable in the
        // DOM; only the rendered `src` is the resolved asset URL. The node's
        // `src` attribute (used by markdown serialization + clipboard) is never
        // touched, so the document round-trips as the relative path.
        data-src={attrs.src ?? undefined}
        draggable={false}
      />
    </NodeViewWrapper>
  );
}

/**
 * The official `Image` extension plus a node view that resolves a
 * workspace-relative `src` to a displayable URL at render time (see
 * [imageSrcResolver]). Default `renderHTML` is left intact, so the node's
 * stored `src` — what markdown serialization and copy/paste read — stays the
 * relative, portable path; only the visible `<img>` uses the resolved asset
 * URL. This is what makes pasted images actually display on the desktop, where
 * a relative `images/…` path is unreachable from the `tauri://localhost`
 * origin.
 */
export const ImageWithAssets = Image.extend<ImageAssetOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      getContext: () => ({ fileDir: null }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageAssetNodeView);
  },
});
