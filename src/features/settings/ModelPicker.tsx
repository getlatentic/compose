import { useMemo, useState } from "react";
import { ComboBox } from "@carbon/react";

import { harnessCapabilitiesOf } from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { findIntendedModel, type ModelItem, modelMatchesQuery } from "./modelMatching";

/**
 * The "Default model" picker for an agent: a ComboBox over its known models — a
 * live-discovered list (Ollama / Codex / OpenRouter / OpenCode) or a curated one
 * (Claude) — with type-ahead. Agents that accept any id (`customModel`)
 * can also type one that isn't listed, so Ollama still works while it's down
 * (type a known id) and custom agents accept anything. An empty value means
 * "Automatic" — the agent picks per chat. Rendered in the agent's main detail
 * (not tucked into the advanced accordion), since it's the setting most people
 * actually touch.
 */
export function ModelPicker({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const options = useHarnessStore((state) => state.harnessOptions[harnessId]);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const harnessModels = useHarnessStore((state) => state.harnessModels);
  const loadHarnessModels = useHarnessStore((state) => state.loadHarnessModels);
  // Memoize so `caps.models` keeps a stable identity between renders, or the
  // controlled ComboBox below sees a fresh `selectedItem` each time.
  const caps = useMemo(
    () => harnessCapabilitiesOf(harnessCatalog, harnessId),
    [harnessCatalog, harnessId],
  );

  const discovered = harnessModels[harnessId];
  const currentModel = options?.model ?? "";

  // Prefer the live-discovered list; fall back to a curated one. Keep the
  // current value selectable even when it predates the list (a custom id).
  const items = useMemo<ModelItem[]>(() => {
    const base = discovered && discovered.length > 0 ? discovered : caps.models;
    if (currentModel && !base.some((model) => model.value === currentModel)) {
      return [{ value: currentModel, label: currentModel }, ...base];
    }
    return base;
  }, [discovered, caps.models, currentModel]);

  const selectedItem = items.find((model) => model.value === currentModel) ?? null;

  // A saved default that's absent from a non-empty discovered list is probably
  // gone — an Ollama model that was deleted, or a provider id dropped from the
  // catalog. It stays selectable (above), but flag it so a new chat doesn't just
  // fail later with a cryptic "model not found". Only when the list actually
  // loaded (length > 0); an empty list means offline/undiscovered, not missing.
  const savedModelMissing =
    !!currentModel &&
    !!discovered &&
    discovered.length > 0 &&
    !discovered.some((model) => model.value === currentModel);

  // A missing value is usually a typo rather than a withdrawn model — the
  // reported case was `gpt-oss-120b` for `openai/gpt-oss-120b`. Naming the
  // model they meant beats telling them it might be gone.
  const intended = useMemo(
    () => (savedModelMissing ? findIntendedModel(discovered ?? [], currentModel) : null),
    [savedModelMissing, discovered, currentModel],
  );

  // Live-discovery agents (no curated list) can gain models after launch — an
  // Ollama pull, a provider catalog refresh — so let the list be re-pulled.
  const canRefresh = caps.models.length === 0;
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadHarnessModels(harnessId);
    } finally {
      setRefreshing(false);
    }
  };

  // Nothing to pick and no custom ids allowed → no picker at all.
  if (items.length === 0 && !caps.customModel) {
    return null;
  }

  return (
    <div className="settings-section">
      <div className="model-picker">
        <ComboBox
          id={`${harnessId}-model`}
          titleText="Default model"
          helperText="Used for new chats. Leave on Automatic to let the agent pick."
          placeholder="Automatic"
          items={items}
          // A committed custom value arrives as a bare string, not a ModelItem,
          // so handle both shapes (Carbon's types only know the item shape).
          // The id, everywhere — in the field and in the list. This field
          // saves an id and a run needs an id, so a friendly name like
          // "GPT OSS 120B" only hid the one string that matters and left no
          // way to learn that a vendor prefix was required.
          itemToString={(item) => {
            const value = item as ModelItem | string | null;
            return value == null ? "" : typeof value === "string" ? value : value.value;
          }}
          // Match the id, the id without its vendor prefix, or the display
          // name — all three are things people type for the same model.
          shouldFilterItem={({ item, inputValue }) =>
            modelMatchesQuery(item as ModelItem, inputValue ?? "")
          }
          selectedItem={selectedItem}
          // A model id is not prose. Autocapitalisation turned a typed
          // `gpt-oss-120b` into `Gpt-oss-120b`, which then matched nothing —
          // and autocorrect and spellcheck are just as wrong on an id.
          inputProps={{
            autoCapitalize: "off",
            autoCorrect: "off",
            autoComplete: "off",
            spellCheck: false,
          }}
          allowCustomValue={caps.customModel}
          onChange={(data) => {
            const picked = data.selectedItem as ModelItem | string | null;
            const next =
              typeof picked === "string"
                ? picked.trim()
                : (picked?.value ??
                  (caps.customModel ? (data.inputValue?.trim() ?? "") : ""));
            setHarnessOptions(harnessId, { model: next || undefined });
          }}
        />
        {canRefresh ? (
          <button
            type="button"
            className="model-picker__refresh"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh list"}
          </button>
        ) : null}
      </div>
      {savedModelMissing ? (
        intended ? (
          <p className="model-picker__stale">
            “{currentModel}” isn’t an id.{" "}
            <button
              type="button"
              className="model-picker__suggest"
              onClick={() => setHarnessOptions(harnessId, { model: intended.value })}
            >
              Use {intended.value}
            </button>{" "}
            ({intended.label})?
          </p>
        ) : (
          <p className="model-picker__stale">
            “{currentModel}” isn’t in the list — it may no longer be available. Pick another above.
          </p>
        )
      ) : null}
    </div>
  );
}
