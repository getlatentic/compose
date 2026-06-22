import { useMemo, useState } from "react";
import { ComboBox } from "@carbon/react";

import { harnessCapabilitiesOf } from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";

interface ModelItem {
  value: string;
  label: string;
}

/**
 * The "Default model" picker for an agent: a ComboBox over its known models — a
 * live-discovered list (Ollama / Codex / OpenRouter / OpenCode) or a curated one
 * (Claude) — with type-ahead. Agents that accept any id (`allowsCustomModel`)
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
  if (items.length === 0 && !caps.allowsCustomModel) {
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
          itemToString={(item) => {
            const value = item as ModelItem | string | null;
            return value == null ? "" : typeof value === "string" ? value : value.label;
          }}
          selectedItem={selectedItem}
          allowCustomValue={caps.allowsCustomModel}
          onChange={(data) => {
            const picked = data.selectedItem as ModelItem | string | null;
            const next =
              typeof picked === "string"
                ? picked.trim()
                : (picked?.value ??
                  (caps.allowsCustomModel ? (data.inputValue?.trim() ?? "") : ""));
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
    </div>
  );
}
