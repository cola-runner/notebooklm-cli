/**
 * Safe array indexing helper.
 *
 * Returns `undefined` for out-of-bounds access by default. With
 * `GEMINI_NOTEBOOK_STRICT_DECODE=1` set, throws — useful for catching response
 * shape regressions during development.
 *
 * Ported from `notebooklm-py/src/notebooklm/rpc/_safe_index.py`.
 */

export function safeIndex(
  arr: unknown,
  index: number,
  methodId?: string,
  source?: string,
): unknown {
  if (!Array.isArray(arr)) return undefined;
  if (index < 0 || index >= arr.length) {
    if (process.env['GEMINI_NOTEBOOK_STRICT_DECODE'] === '1') {
      throw new RangeError(
        `safeIndex out of bounds: index=${index} len=${arr.length} method=${methodId ?? '?'} source=${source ?? '?'}`,
      );
    }
    return undefined;
  }
  return arr[index];
}
