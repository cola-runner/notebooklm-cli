/**
 * Chat API — ask a question against a notebook's sources.
 *
 * Uses the streamed-chat endpoint (`GenerateFreeFormStreamed`), not the
 * batchexecute RPC. Request format is similar but not identical:
 * `f.req = [null, json_params]` (no triple nesting), and the response
 * is a stream of `wrb.fr` envelopes whose inner JSON contains the answer
 * text + citations.
 *
 * Ported from `notebooklm-py/src/notebooklm/_chat_protocol.py` — answer text
 * plus citations (source id, cited passage, char ranges, relevance score).
 */

import { request } from 'undici';
import { rpcHeaders } from '../auth/headers.js';
import { nestSourceIds } from '../rpc/encoder.js';
import { AuthError, ChatError } from '../rpc/errors.js';
import { getQueryUrl } from '../rpc/types.js';
import type { Session } from '../session/session.js';
import type { AskResult, ChatReference } from '../types.js';
import { SourcesAPI } from './sources.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One cached Q&A exchange, used to rebuild conversation history for follow-ups. */
interface Turn {
  query: string;
  answer: string;
}

/** Cap on remembered turns per conversation (keeps the history payload bounded). */
const MAX_CACHED_TURNS = 20;

export class ChatAPI {
  private readonly sources: SourcesAPI;
  /** Per-instance conversation history: conversationId → ordered turns. */
  private readonly conversations = new Map<string, Turn[]>();

  constructor(private readonly session: Session) {
    this.sources = new SourcesAPI(session);
  }

  /**
   * Ask the notebook a question. Returns the answer text, citations, and the
   * server-recorded conversation id.
   *
   * Pass `conversationId` (from a prior ask) to continue a conversation: the
   * server keeps context server-side, and within this same client instance we
   * also replay the cached turns as `conversation_history` so the model sees
   * the prior exchange. A fresh process has an empty cache and relies on the
   * server-side conversation alone.
   *
   * @param sourceIds Optional list of source ids to scope the query. If
   *   omitted, all sources in the notebook are queried.
   */
  async ask(
    notebookId: string,
    question: string,
    opts: { sourceIds?: string[]; conversationId?: string } = {},
  ): Promise<AskResult> {
    const sourceIds = opts.sourceIds ?? (await this.sources.list(notebookId)).map((s) => s.id);
    const sourcesArray = nestSourceIds(sourceIds, 2);

    const conversationId = opts.conversationId ?? null;
    const history = conversationId ? this.buildConversationHistory(conversationId) : null;

    const params: unknown[] = [
      sourcesArray,
      question,
      history,
      [2, null, [1], [1]],
      conversationId,
      null,
      null,
      notebookId,
      1,
    ];

    const tokens = await this.session.ensureTokens();
    const csrf = tokens.csrf;
    const sessionId = tokens.sessionId;

    const fReqJson = JSON.stringify([null, JSON.stringify(params)]);
    const bodyParts = [`f.req=${encodeURIComponent(fReqJson)}`];
    if (csrf) bodyParts.push(`at=${encodeURIComponent(csrf)}`);
    const body = `${bodyParts.join('&')}&`;

    const url = new URL(getQueryUrl());
    url.searchParams.set('bl', 'boq_labs-tailwind-frontend_20250101.00_p0');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('_reqid', String(Math.floor(Math.random() * 9_000_000) + 1_000_000));
    url.searchParams.set('rt', 'c');
    if (sessionId) url.searchParams.set('f.sid', sessionId);

    const res = await request(url.toString(), {
      method: 'POST',
      headers: {
        ...rpcHeaders(),
        Cookie: this.session.transport.cookieHeader(),
      },
      body,
    });
    const text = await res.body.text();

    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new AuthError(`Chat request failed (HTTP ${res.statusCode}).`, {
        rawResponse: text,
      });
    }
    if (res.statusCode >= 400) {
      throw new ChatError(`Chat request failed (HTTP ${res.statusCode}).`, {
        rawResponse: text,
      });
    }

    const parsed = parseStreamingChatResponse(text);
    const result: AskResult = {
      answer: parsed.answer,
      references: parsed.references,
    };

    // Resolve the real conversation id. For a follow-up it's the one we were
    // given; for a new conversation the streamed response never carries it, so
    // recover it via GET_LAST_CONVERSATION_ID (best effort).
    const realId = conversationId ?? (await this.getConversationId(notebookId));
    if (realId) {
      result.conversationId = realId;
      this.cacheTurn(realId, question, parsed.answer);
    }

    return result;
  }

  /**
   * Fetch the most recent conversation id for a notebook (the hPTbtc RPC).
   * Returns undefined if none exists or the call fails — callers treat the
   * conversation id as best-effort metadata.
   */
  async getConversationId(notebookId: string): Promise<string | undefined> {
    try {
      // Params must be [[], null, notebookId, 1]; response is [[[conv_id]]].
      const raw = await this.session.call<unknown>(
        'GET_LAST_CONVERSATION_ID',
        [[], null, notebookId, 1],
        { allowNull: true },
      );
      if (!Array.isArray(raw)) return undefined;
      for (const group of raw) {
        if (!Array.isArray(group)) continue;
        for (const conv of group) {
          if (Array.isArray(conv) && typeof conv[0] === 'string') return conv[0];
        }
      }
    } catch {
      // best effort
    }
    return undefined;
  }

  /**
   * Build the `conversation_history` payload for a follow-up from cached turns.
   * Each turn contributes `[answer, null, 2]` then `[query, null, 1]` (the wire
   * order NotebookLM expects). Returns null when nothing is cached.
   */
  private buildConversationHistory(conversationId: string): unknown[] | null {
    const turns = this.conversations.get(conversationId);
    if (!turns || turns.length === 0) return null;
    const history: unknown[] = [];
    for (const turn of turns) {
      history.push([turn.answer, null, 2]);
      history.push([turn.query, null, 1]);
    }
    return history;
  }

  /** Record a completed turn so the next follow-up can replay it as history. */
  private cacheTurn(conversationId: string, query: string, answer: string): void {
    const turns = this.conversations.get(conversationId) ?? [];
    turns.push({ query, answer });
    if (turns.length > MAX_CACHED_TURNS) turns.splice(0, turns.length - MAX_CACHED_TURNS);
    this.conversations.set(conversationId, turns);
  }
}

/**
 * Parse the streamed-chat response into the best answer text plus its
 * citations. Answer candidates come in "marked" (final answer, the chunk
 * whose `first[4]` ends in 1) and "unmarked" (interim) flavors; we keep the
 * longest of each and prefer the marked one, returning the references that
 * arrived with the chosen candidate. Citation numbers are assigned in
 * answer-array order (the inline `[n]` markers).
 */
export function parseStreamingChatResponse(responseText: string): {
  answer: string;
  references: ChatReference[];
} {
  let body = responseText;
  if (body.startsWith(")]}'")) body = body.slice(4);
  const lines = body.trim().split('\n');

  let bestMarked = '';
  let bestMarkedRefs: ChatReference[] = [];
  let bestUnmarked = '';
  let bestUnmarkedRefs: ChatReference[] = [];
  let anyParseable = false;

  const processChunk = (jsonStr: string): void => {
    let data: unknown;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return;
    }
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (!Array.isArray(item) || item.length < 3) continue;
      if (item[0] !== 'wrb.fr') continue;
      const innerJson = item[2];
      if (typeof innerJson !== 'string') {
        // item[2] is null — item[5] may carry a server-side error payload
        // (e.g. a rate-limit / UserDisplayableError). Surface it as ChatError.
        if (item.length > 5 && Array.isArray(item[5])) raiseIfRateLimited(item[5]);
        continue;
      }
      let innerData: unknown;
      try {
        innerData = JSON.parse(innerJson);
      } catch {
        continue;
      }
      anyParseable = true;
      if (!Array.isArray(innerData) || innerData.length === 0) continue;
      const first = innerData[0];
      if (!Array.isArray(first) || first.length === 0) continue;
      const text = first[0];
      if (typeof text !== 'string' || text.length === 0) continue;
      const f4 = first[4];
      const isAnswer = Array.isArray(f4) && f4.length > 0 && f4[f4.length - 1] === 1;
      const refs = parseCitations(first);
      if (isAnswer) {
        if (text.length > bestMarked.length) {
          bestMarked = text;
          bestMarkedRefs = refs;
        }
      } else if (text.length > bestUnmarked.length) {
        bestUnmarked = text;
        bestUnmarkedRefs = refs;
      }
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    if (!line) {
      i++;
      continue;
    }
    if (/^-?\d+$/.test(line)) {
      i++;
      const next = lines[i];
      if (next) processChunk(next);
      i++;
    } else {
      processChunk(line);
      i++;
    }
  }

  if (!anyParseable) {
    throw new ChatError(
      `No parseable chunks in streaming chat response (${lines.length} lines scanned). The response was empty or the API wire format may have changed.`,
    );
  }

  const answer = bestMarked || bestUnmarked;
  const references = bestMarked ? bestMarkedRefs : bestUnmarkedRefs;
  // Number citations in the order they appear (the inline [n] markers).
  references.forEach((ref, idx) => {
    if (ref.citationNumber === undefined) ref.citationNumber = idx + 1;
  });
  return { answer, references };
}

/** Throw ChatError if a `wrb.fr` error payload carries a UserDisplayableError. */
function raiseIfRateLimited(errorPayload: unknown[]): void {
  const entries = errorPayload.length > 2 ? errorPayload[2] : undefined;
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      entry[0].includes('UserDisplayableError')
    ) {
      throw new ChatError(
        'Chat request was rate limited or rejected by the API. Wait a few seconds and try again.',
      );
    }
  }
}

/** Parse all citations attached to an answer chunk (`first[4][3]`). */
function parseCitations(first: unknown[]): ChatReference[] {
  const typeInfo = first.length > 4 ? first[4] : undefined;
  if (!Array.isArray(typeInfo) || typeInfo.length <= 3 || !Array.isArray(typeInfo[3])) return [];
  const refs: ChatReference[] = [];
  for (const cite of typeInfo[3]) {
    const ref = parseSingleCitation(cite);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** Parse one citation entry into a ChatReference (null if it has no source id). */
function parseSingleCitation(cite: unknown): ChatReference | null {
  if (!Array.isArray(cite) || cite.length < 2) return null;
  const citeInner = cite[1];
  if (!Array.isArray(citeInner)) return null;

  const sourceId = extractUuidFromNested(citeInner.length > 5 ? citeInner[5] : null);
  if (!sourceId) return null;

  const ref: ChatReference = { sourceId };

  if (Array.isArray(cite[0]) && cite[0].length > 0 && typeof cite[0][0] === 'string') {
    ref.chunkId = cite[0][0];
  }

  const { citedText, startChar, endChar } = extractTextPassages(citeInner);
  if (citedText !== undefined) ref.citedText = citedText;
  if (startChar !== undefined && endChar !== undefined) {
    ref.startChar = startChar;
    ref.endChar = endChar;
  }

  const [answerStart, answerEnd] = extractAnswerRange(citeInner);
  if (answerStart !== undefined && answerEnd !== undefined) {
    ref.answerStartChar = answerStart;
    ref.answerEndChar = answerEnd;
  }

  const score = extractScore(citeInner);
  if (score !== undefined) ref.score = score;

  return ref;
}

/** The answer-text span this citation supports: `citeInner[3] = [[null, start, end]]`. */
function extractAnswerRange(citeInner: unknown[]): [number | undefined, number | undefined] {
  if (citeInner.length <= 3 || !Array.isArray(citeInner[3])) return [undefined, undefined];
  const outer = citeInner[3];
  if (outer.length === 0 || !Array.isArray(outer[0])) return [undefined, undefined];
  const inner = outer[0];
  if (inner.length < 3) return [undefined, undefined];
  const start = inner[1];
  const end = inner[2];
  if (!isNonNegInt(start) || !isNonNegInt(end) || end < start) return [undefined, undefined];
  return [start, end];
}

/** Server-side relevance score at `citeInner[2]`, clamped to a finite [0,1]. */
function extractScore(citeInner: unknown[]): number | undefined {
  if (citeInner.length <= 2) return undefined;
  const raw = citeInner[2];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) return undefined;
  return raw;
}

/** Cited text + source-side char range from `citeInner[4]` (a paired range). */
function extractTextPassages(citeInner: unknown[]): {
  citedText?: string;
  startChar?: number;
  endChar?: number;
} {
  if (citeInner.length <= 4 || !Array.isArray(citeInner[4])) return {};
  const texts: string[] = [];
  let startChar: number | undefined;
  let endChar: number | undefined;

  for (const wrapper of citeInner[4]) {
    if (!Array.isArray(wrapper) || wrapper.length === 0) continue;
    const passage = wrapper[0];
    if (!Array.isArray(passage) || passage.length < 3) continue;
    if (startChar === undefined && isNonNegInt(passage[0])) startChar = passage[0];
    if (isNonNegInt(passage[1])) endChar = passage[1];
    collectTextsFromNested(passage[2], texts);
  }

  const out: { citedText?: string; startChar?: number; endChar?: number } = {};
  if (texts.length > 0) out.citedText = texts.join(' ');
  // Keep the source range only if fully populated and well-ordered.
  if (startChar !== undefined && endChar !== undefined && startChar <= endChar) {
    out.startChar = startChar;
    out.endChar = endChar;
  }
  return out;
}

/** Collect non-empty text fragments from a deeply nested passage structure. */
function collectTextsFromNested(nested: unknown, texts: string[]): void {
  if (!Array.isArray(nested)) return;
  for (const group of nested) {
    if (!Array.isArray(group)) continue;
    for (const inner of group) {
      if (!Array.isArray(inner) || inner.length < 3) continue;
      const val = inner[2];
      if (typeof val === 'string' && val.trim()) {
        texts.push(val.trim());
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.trim()) texts.push(item.trim());
        }
      }
    }
  }
}

/** Recursively find the first UUID string in a nested list structure. */
function extractUuidFromNested(data: unknown, maxDepth = 10): string | undefined {
  if (maxDepth <= 0 || data == null) return undefined;
  if (typeof data === 'string') return UUID_RE.test(data) ? data : undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = extractUuidFromNested(item, maxDepth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** True for a non-negative integer that is not a boolean. */
function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
