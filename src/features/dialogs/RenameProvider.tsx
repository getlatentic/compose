import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@carbon/react";
import { Folder } from "@carbon/react/icons";

import { renameRelativePath, splitFileName } from "../../lib/files/fileName";

/**
 * In-app "Rename file" dialog.
 *
 * A file is renamed by its base name only: the directory and the extension are
 * preserved and shown read-only, so the user can't accidentally move the file
 * or change/drop its extension (e.g. turn a `.md` note into an extensionless
 * file). The extension stays generic, so future types (html, canvas, xml, …)
 * are handled the same way. Mirrors useTextPrompt / useConfirm — one shared
 * modal at the app root, an imperative `requestRename(path)` resolving to the
 * new relative path (or `null` on cancel).
 */
type RenameFn = (path: string) => Promise<string | null>;

const RenameContext = createContext<RenameFn | null>(null);

export function useRename(): RenameFn {
  const rename = useContext(RenameContext);
  if (!rename) {
    throw new Error("useRename must be used within a RenameProvider");
  }
  return rename;
}

interface PendingRename {
  path: string;
  resolve: (value: string | null) => void;
}

const INPUT_ID = "rename-input";

export function RenameProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingRename | null>(null);
  const [value, setValue] = useState("");

  const requestRename = useCallback<RenameFn>((path) => {
    return new Promise<string | null>((resolve) => {
      setValue(splitFileName(path).base);
      setPending({ path, resolve });
    });
  }, []);

  const cancel = useCallback(() => {
    setPending((current) => {
      current?.resolve(null);
      return null;
    });
  }, []);

  const trimmed = value.trim();
  const submit = useCallback(() => {
    if (trimmed === "") return;
    setPending((current) => {
      current?.resolve(renameRelativePath(current.path, trimmed));
      return null;
    });
  }, [trimmed]);

  const split = pending ? splitFileName(pending.path) : null;
  const location = split && split.dir ? split.dir.replace(/\/+$/, "") : "Top level";

  return (
    <RenameContext.Provider value={requestRename}>
      {children}
      <Modal
        open={pending !== null}
        modalHeading="Rename file"
        primaryButtonText="Rename"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={trimmed === ""}
        selectorPrimaryFocus={`#${INPUT_ID}`}
        size="sm"
        onRequestSubmit={submit}
        onRequestClose={cancel}
      >
        <div className="rename-field">
          <label className="cds--label" htmlFor={INPUT_ID}>
            Name
          </label>
          <div className="rename-field__row">
            <input
              id={INPUT_ID}
              className="cds--text-input rename-field__input"
              type="text"
              value={value}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            {split?.ext ? (
              <span className="rename-field__ext" title="The extension is kept">
                {split.ext}
              </span>
            ) : null}
          </div>
          <p className="rename-field__location">
            <Folder size={14} />
            <span>{location}</span>
          </p>
        </div>
      </Modal>
    </RenameContext.Provider>
  );
}
