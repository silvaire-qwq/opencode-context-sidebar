/**
 * Token estimates for prompt components.
 *
 * The provider's reported input usage is exact, but it does not say how the
 * prompt splits into system instructions, tool schemas, skills, and messages.
 * These estimates provide that split; the server rescales them to the reported
 * prompt size before returning a snapshot.
 */

const CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g

/** Rough token count: one token per CJK character, four characters otherwise. */
export function estimateText(text: string): number {
  if (!text) return 0
  const cjk = (text.match(CJK) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/** Keys that hold replay data or duplicates rather than prompt content. */
const SKIP_KEYS = new Set(["metadata", "native", "providerMetadata"])

/**
 * Estimate a structured value. Binary payloads are ignored because their token
 * cost is provider-specific and usually not part of the text budget.
 */
export function estimateValue(value: unknown, seen = new Set<unknown>()): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "string") return estimateText(value)
  if (typeof value === "number" || typeof value === "boolean") return 1
  if (typeof value !== "object") return 0

  if (seen.has(value)) return 0
  seen.add(value)

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return 0

  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) total += estimateValue(item, seen)
    return total
  }

  let total = 0
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue
    total += estimateValue(item, seen)
  }
  return total
}
