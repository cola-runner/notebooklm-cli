/**
 * Chat API — ask a question against a notebook's sources.
 *
 * Uses the streamed-chat endpoint (`GenerateFreeFormStreamed`), not the
 * batchexecute RPC. Request format is similar but not identical:
 * `f.req = [null, json_params]` (no triple nesting), and the response
 * is a stream of `wrb.fr` envelopes whose inner JSON contains the answer
 * text + citations.
 *
 * Ported (minimal subset — answer extraction only, no citations yet) from
 * `notebooklm-py/src/notebooklm/_chat_protocol.py`.
 */

import { request } from 'undici';
import { rpcHeaders } from '../auth/headers.js';
import { nestSourceIds } from '../rpc/encoder.js';
import { AuthError, ChatError } from '../rpc/errors.js';
import { getQueryUrl } from '../rpc/types.js';
import type { Session } from '../session/session.js';
import type { AskResult } from '../types.js';
import { SourcesAPI } from './sources.js';

export class ChatAPI {
  private readonly sources: SourcesAPI;

  constructor(private readonly session: Session) {
    this.sources = new SourcesAPI(session);
  }

  /**
   * Ask the notebook a question. Returns the answer text plus the
   * server-recorded conversation id (fetched via GET_LAST_CONVERSATION_ID
   * after the streamed answer completes).
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

    const params: unknown[] = [
      sourcesArray,
      question,
      null, // conversation_history (TODO when we add follow-ups)
      [2, null, [1], [1]],
      opts.conversationId ?? null,
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
      references: [],
    };

    // Fetch the server-recorded conversation id for follow-ups (best effort)
    try {
      const conv = await this.session.call<unknown>('GET_LAST_CONVERSATION_ID', [notebookId], {
        allowNull: true,
      });
      if (Array.isArray(conv) && typeof conv[0] === 'string') {
        result.conversationId = conv[0];
      }
    } catch {
      // best effort
    }

    return result;
  }
}

/**
 * Parse the streamed-chat response and pull out the longest "marked"
 * answer text. Ignores citations for v0.1 — they're a follow-up.
 */
export function parseStreamingChatResponse(responseText: string): { answer: string } {
  let body = responseText;
  if (body.startsWith(")]}'")) body = body.slice(4);
  const lines = body.trim().split('\n');

  let bestMarked = '';
  let bestUnmarked = '';
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
      if (typeof innerJson !== 'string') continue;
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
      if (isAnswer) {
        if (text.length > bestMarked.length) bestMarked = text;
      } else if (text.length > bestUnmarked.length) {
        bestUnmarked = text;
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

  return { answer: bestMarked || bestUnmarked };
}
