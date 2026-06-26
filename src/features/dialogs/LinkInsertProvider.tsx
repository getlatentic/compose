import {
  Modal,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  TextInput,
  Search,
} from "@carbon/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LinkInsertResult =
  | { type: "url"; url: string; text: string }
  | { type: "wikilink"; path: string };

export interface LinkPromptOptions {
  linkTargets: ReadonlySet<string>;
  initialUrl?: string;
  initialText?: string;
  defaultTab?: "url" | "file";
  title?: string;
}

type PromptLinkFn = (options: LinkPromptOptions) => Promise<LinkInsertResult | null>;

const LinkPromptContext = createContext<PromptLinkFn | null>(null);

export function useLinkPrompt(): PromptLinkFn {
  const fn = useContext(LinkPromptContext);
  if (!fn) throw new Error("useLinkPrompt must be used within a LinkInsertProvider");
  return fn;
}

interface PendingLink extends LinkPromptOptions {
  resolve: (result: LinkInsertResult | null) => void;
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function LinkInsertProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [activeTab, setActiveTab] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);

  const promptLink = useCallback<PromptLinkFn>((options) => {
    return new Promise<LinkInsertResult | null>((resolve) => {
      setUrl(options.initialUrl ?? "");
      setText(options.initialText ?? "");
      setFilter("");
      setHighlight(null);
      setActiveTab(options.defaultTab ?? "url");
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((result: LinkInsertResult | null) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const targets = useMemo<string[]>(() => {
    if (!pending) return [];
    return [...pending.linkTargets].sort((a, b) => a.localeCompare(b));
  }, [pending]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? targets.filter((p) => p.toLowerCase().includes(q)) : targets;
  }, [targets, filter]);

  const trimmedUrl = url.trim();
  const trimmedText = text.trim();
  const canSubmit = activeTab === "url" ? trimmedUrl !== "" : highlight !== null;

  function submit() {
    if (!canSubmit) return;
    if (activeTab === "url") {
      settle({ type: "url", url: trimmedUrl, text: trimmedText || trimmedUrl });
    } else if (highlight) {
      settle({ type: "wikilink", path: stripMdExtension(highlight) });
    }
  }

  return (
    <LinkPromptContext.Provider value={promptLink}>
      {children}
      <Modal
        open={pending !== null}
        modalHeading={pending?.title ?? "Insert link"}
        primaryButtonText="Insert"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!canSubmit}
        size="md"
        onRequestSubmit={submit}
        onRequestClose={() => settle(null)}
      >
        <Tabs
          selectedIndex={activeTab === "url" ? 0 : 1}
          onChange={({ selectedIndex }) => setActiveTab(selectedIndex === 0 ? "url" : "file")}
        >
          <TabList aria-label="Link source" contained>
            <Tab>URL</Tab>
            <Tab>File</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <Stack gap={5}>
                <TextInput
                  id="link-insert-url"
                  labelText="URL"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <TextInput
                  id="link-insert-text"
                  labelText="Display text"
                  helperText="Optional — defaults to the URL"
                  placeholder=""
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </Stack>
            </TabPanel>
            <TabPanel>
              <Stack gap={5}>
                <Search
                  id="link-insert-file-search"
                  labelText="Search workspace files"
                  placeholder="Type to filter…"
                  size="md"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="file-picker" role="listbox" aria-label="Workspace files">
                  {filtered.length === 0 ? (
                    <p className="file-picker__empty">No files match.</p>
                  ) : (
                    filtered.map((path) => {
                      const dir = parentDir(path);
                      const isActive = highlight === path;
                      return (
                        <button
                          key={path}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          className={`file-picker__item${
                            isActive ? " file-picker__item--active" : ""
                          }`}
                          onClick={() => setHighlight(path)}
                          onDoubleClick={() => {
                            setHighlight(path);
                            settle({ type: "wikilink", path: stripMdExtension(path) });
                          }}
                        >
                          <span className="file-picker__name">{basename(path)}</span>
                          {dir ? <span className="file-picker__dir">{dir}</span> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </Stack>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Modal>
    </LinkPromptContext.Provider>
  );
}
