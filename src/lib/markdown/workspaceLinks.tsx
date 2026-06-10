import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import type { Components } from "hast-util-to-jsx-runtime";

import { openExternalUrl } from "../links/openExternal";
import { resolveWorkspaceLink } from "../links/workspaceLink";

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
  const resolved = href
    ? resolveWorkspaceLink(href, {
        fromPath: context?.fromPath,
        knownPaths: context?.knownPaths ?? NO_PATHS,
      })
    : null;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // We own navigation for resolved links; let truly-unresolved hrefs fall
    // through as inert (a broken relative path shouldn't navigate the webview).
    event.preventDefault();
    if (!resolved) {
      return;
    }
    if (resolved.kind === "internal") {
      context?.navigate(resolved.path);
    } else {
      void openExternalUrl(resolved.href);
    }
  };

  return (
    <a
      href={href ?? undefined}
      className={resolved?.kind === "internal" ? "bob-internal-link" : undefined}
      rel={resolved?.kind === "external" ? "noopener noreferrer" : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

/**
 * Component overrides to pass to {@link renderMarkdownToReact}. Module-level
 * constant so it stays referentially stable — chat bubbles memoized on their
 * content don't re-render just because links became navigable.
 */
export const workspaceMarkdownComponents: Partial<Components> = { a: MarkdownLink };
