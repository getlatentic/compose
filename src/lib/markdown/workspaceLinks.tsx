import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import type { Components } from "hast-util-to-jsx-runtime";

import { openExternalUrl } from "../links/openExternal";
import { resolveWorkspaceLink } from "ai-editor";
import { resolveWikilinkTarget } from "ai-editor";

/** Href prefix the wikilink remark plugin emits (`#wikilink:<encoded-target>`);
 * a fragment URL, so it survives `rehype-sanitize`. */
const WIKILINK_HREF_PREFIX = "#wikilink:";

/**
 * Makes markdown links rendered by {@link renderMarkdownToReact} navigate the
 * workspace: an internal link opens the target file in a tab, an external link
 * opens in the browser. Supplied via context so the link components read it
 * without prop-drilling through every memoized chat bubble.
 */
export interface MarkdownLinkContextValue {
  /** Open a workspace-relative file path in a tab. */
  navigate: (path: string) => void;
  /** Every workspace-relative file path, for resolving internal links. */
  knownPaths: ReadonlySet<string>;
  /** The document a link lives in, if any (chat replies have none → root). */
  fromPath?: string;
}

export const MarkdownLinkContext = createContext<MarkdownLinkContextValue | null>(null);

const NO_PATHS: ReadonlySet<string> = new Set();

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const context = useContext(MarkdownLinkContext);
  const knownPaths = context?.knownPaths ?? NO_PATHS;

  // Classify the href into one navigation action. A `#wikilink:` href is an
  // agent's `[[Note]]`; everything else is a normal markdown link.
  let internalPath: string | null = null;
  let externalHref: string | null = null;
  let isWikilink = false;
  if (href?.startsWith(WIKILINK_HREF_PREFIX)) {
    isWikilink = true;
    internalPath = resolveWikilinkTarget(decodeWikilinkTarget(href), {
      fromPath: context?.fromPath,
      knownPaths,
    });
  } else if (href) {
    const resolved = resolveWorkspaceLink(href, { fromPath: context?.fromPath, knownPaths });
    if (resolved?.kind === "internal") {
      internalPath = resolved.path;
    } else if (resolved?.kind === "external") {
      externalHref = resolved.href;
    }
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // We own navigation; unresolved hrefs (a broken relative path or a wikilink
    // pointing at no file) stay inert rather than navigating the webview.
    event.preventDefault();
    if (internalPath) {
      context?.navigate(internalPath);
    } else if (externalHref) {
      void openExternalUrl(externalHref);
    }
  };

  const className = internalPath
    ? "internal-link"
    : isWikilink
      ? "wikilink wikilink--broken"
      : undefined;

  return (
    <a
      href={href ?? undefined}
      className={className}
      rel={externalHref ? "noopener noreferrer" : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

function decodeWikilinkTarget(href: string): string {
  const encoded = href.slice(WIKILINK_HREF_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Component overrides to pass to {@link renderMarkdownToReact}. Module-level
 * constant so it stays referentially stable — chat bubbles memoized on their
 * content don't re-render just because links became navigable.
 */
export const workspaceMarkdownComponents: Partial<Components> = { a: MarkdownLink };
