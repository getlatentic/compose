import {
  Accordion,
  AccordionItem,
  Button,
  InlineNotification,
  Tag,
  TextInput,
} from "@carbon/react";

import { useHarnessStore } from "../../app/store/harnessStore";
import {
  runtimeDetailsOf,
  type HarnessInfo,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import { agentStatus, statusTagType } from "./agentStatus";
import { installKindBadge } from "./installKind";
import { useRuntimeInstall } from "./useRuntimeInstall";

/**
 * One agent's row in the Runtimes panel: display name, version, status, an
 * install-kind badge (where the adapter reports one), and an Update / Install
 * action. The resolved binary path, the kind's plain-English note, and the
 * (pending) explicit-path override live behind a "Details" disclosure — the
 * non-technical default is just status + an update affordance.
 *
 * Degrades gracefully: install kind + resolved path come from the readiness
 * `details`, which only the claude adapter populates today (and only once the
 * harness change ships), so a missing kind hides the badge while version +
 * status still render.
 */
export function RuntimeRow({
  info,
  readiness,
  checking,
  onReadiness,
}: {
  info: HarnessInfo;
  readiness: HarnessReadiness | null;
  checking: boolean;
  onReadiness: (readiness: HarnessReadiness | null) => void;
}) {
  const status = checking ? null : agentStatus(info, readiness);
  const { resolvedPath, installKind } = runtimeDetailsOf(readiness);
  const badge = installKind ? installKindBadge(installKind) : null;
  const install = useRuntimeInstall(info.id, onReadiness);
  const binaryPath = useHarnessStore((state) => state.harnessOptions[info.id]?.binaryPath ?? "");
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);

  const installed = readiness?.installed ?? false;
  const actionLabel = !installed
    ? `Install ${info.displayName}`
    : installKind === "npm-global"
      ? "Update to native"
      : "Update";

  // Only a CLI that Compose can install/update gets an action. A harness with no
  // managed install path (e.g. a local server like Ollama) shows status only.
  const canManage = info.requiresInstall;

  return (
    <li className="runtime-row">
      <div className="runtime-row__main">
        <div className="runtime-row__head">
          <strong>{info.displayName}</strong>
          {checking ? (
            <span className="runtime-row__checking">Checking…</span>
          ) : (
            <>
              {readiness?.version ? (
                <span className="runtime-row__version">{readiness.version}</span>
              ) : null}
              {status?.kind === "ready" ? (
                <Tag size="sm" type="green">
                  Ready
                </Tag>
              ) : status ? (
                <Tag size="sm" type={statusTagType(status.tone)}>
                  {status.label}
                </Tag>
              ) : null}
              {badge ? (
                <Tag size="sm" type={badge.tone} title={badge.note}>
                  {badge.label}
                </Tag>
              ) : null}
            </>
          )}
        </div>
        {badge ? <span className="runtime-row__note">{badge.note}</span> : null}
      </div>

      {canManage ? (
        <div className="runtime-row__action">
          <Button
            size="sm"
            kind={installed ? "tertiary" : "primary"}
            disabled={install.running}
            onClick={() => void install.run()}
          >
            {install.running ? "Working…" : actionLabel}
          </Button>
        </div>
      ) : null}

      <Accordion className="runtime-row__details">
        <AccordionItem title="Details">
          <dl className="runtime-detail">
            <dt>Resolved path</dt>
            <dd className="runtime-detail__path">
              {resolvedPath ?? <span className="runtime-detail__muted">Not reported yet</span>}
            </dd>
          </dl>

          <TextInput
            id={`${info.id}-explicit-path`}
            size="sm"
            labelText="Explicit path (override)"
            helperText="Pin this agent to a specific binary instead of resolving its name on PATH. Leave blank to use PATH."
            placeholder={resolvedPath ?? "/path/to/binary"}
            value={binaryPath}
            onChange={(event) =>
              setHarnessOptions(info.id, { binaryPath: event.target.value.trim() || undefined })
            }
          />

          {canManage ? (
            <div className="runtime-detail__actions">
              <Button
                size="sm"
                kind="ghost"
                disabled={install.running}
                onClick={() => void install.run()}
              >
                {install.running ? "Working…" : "Reinstall"}
              </Button>
            </div>
          ) : null}

          {install.log.length > 0 ? (
            <pre
              className="settings-install-log"
              aria-label={`${info.displayName} update progress`}
              aria-live="polite"
            >
              {install.log.map((entry, i) => (
                <div
                  key={i}
                  className={`settings-install-log__line settings-install-log__line--${entry.kind}`}
                >
                  {entry.kind === "step" ? "› " : entry.kind === "stderr" ? "! " : "  "}
                  {entry.text}
                </div>
              ))}
            </pre>
          ) : null}

          {install.result ? (
            <InlineNotification
              hideCloseButton
              kind={install.result.ok ? "success" : "error"}
              lowContrast
              title={install.result.ok ? `${info.displayName} updated` : "Update failed"}
              subtitle={
                install.result.ok
                  ? `${info.displayName} is up to date.`
                  : `Exited with code ${install.result.exitCode ?? "?"}. Check the log above.`
              }
            />
          ) : null}
          {install.error ? (
            <InlineNotification
              hideCloseButton
              kind="error"
              lowContrast
              subtitle={install.error}
              title="Update error"
            />
          ) : null}
        </AccordionItem>
      </Accordion>
    </li>
  );
}
