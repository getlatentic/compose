/**
 * Matching a typed model against a provider's list.
 *
 * The field stores an id, so the id is what the picker shows. But ids are not
 * what people carry in their heads: OpenRouter namespaces everything as
 * `openai/gpt-oss-120b` while the model is known as "gpt-oss-120b", and the
 * catalog calls it "GPT OSS 120B". Someone typing any of those three means the
 * same model, and a picker that only does exact matching tells them it "may no
 * longer be available" — which sends them looking for the wrong problem.
 *
 * So matching normalises away the parts that carry no meaning (case,
 * separators) and treats a namespace prefix as optional.
 */

export interface ModelItem {
  value: string;
  label: string;
}

/**
 * Reduce a model name to the characters that distinguish it. `GPT OSS 120B`,
 * `gpt-oss-120b`, and `gpt_oss_120b` all become `gptoss120b`; only the
 * alphanumerics carry meaning, and a colon tag (`:free`, `:20b`) does too, so
 * it survives as its digits and letters.
 */
export function normalizeModelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The part after the last `/` — `openai/gpt-oss-120b` → `gpt-oss-120b`. */
function withoutNamespace(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

/**
 * Whether `item` is a plausible match for what the user typed. Used to filter
 * the dropdown, so it is deliberately generous: a substring of the id, the
 * un-namespaced id, or the display name all count.
 */
export function modelMatchesQuery(item: ModelItem, query: string): boolean {
  const q = normalizeModelName(query);
  if (!q) {
    return true;
  }
  return (
    normalizeModelName(item.value).includes(q) ||
    normalizeModelName(withoutNamespace(item.value)).includes(q) ||
    normalizeModelName(item.label).includes(q)
  );
}

/**
 * The model a typed string most likely meant, or `null`.
 *
 * Only exact-after-normalisation counts here — this drives a "did you mean"
 * suggestion, and a loose match would confidently propose the wrong model.
 * Tried in order of how sure we are: the whole id, the id without its
 * namespace, then the display name.
 */
export function findIntendedModel(items: ModelItem[], typed: string): ModelItem | null {
  const q = normalizeModelName(typed);
  if (!q) {
    return null;
  }
  return (
    items.find((item) => normalizeModelName(item.value) === q) ??
    items.find((item) => normalizeModelName(withoutNamespace(item.value)) === q) ??
    items.find((item) => normalizeModelName(item.label) === q) ??
    null
  );
}
