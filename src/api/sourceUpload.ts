/**
 * Pure helpers for the file-upload source flow (`SourcesAPI.addFile`).
 *
 * Ported from `notebooklm-py/src/notebooklm/_source/upload.py` +
 * `_source/upload_payloads.py`. The upload itself is a Google "Scotty"
 * resumable upload: register the source (ADD_SOURCE_FILE) → POST a `start`
 * handshake to `/upload/_/` and read the session URL from the
 * `x-goog-upload-url` response header → POST the bytes with
 * `x-goog-upload-command: upload, finalize`.
 *
 * These functions are the position-/format-sensitive, side-effect-free parts,
 * split out so they can be unit-tested against golden payloads without HTTP.
 */

import { extname } from 'node:path';
import { getUploadUrl } from '../rpc/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extension → MIME for the upload `start` handshake (Gemini Notebook's accepted types). */
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.epub': 'application/epub+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

const HTML_SUFFIXES = new Set(['.html', '.htm', '.xhtml', '.shtml']);
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/**
 * ADD_SOURCE_FILE params that register an upload intent and return a SOURCE_ID.
 * Mirrors `build_register_file_source_params` verbatim — the source id, not the
 * upload handle, is what threads through to the resumable upload's start body.
 */
export function buildRegisterFileParams(filename: string, notebookId: string): unknown[] {
  return [
    [[filename]],
    notebookId,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];
}

/** JSON body for the resumable-upload `start` request (sent as form-urlencoded). */
export function buildUploadStartBody(
  notebookId: string,
  filename: string,
  sourceId: string,
): string {
  return JSON.stringify({
    PROJECT_ID: notebookId,
    SOURCE_NAME: filename,
    SOURCE_ID: sourceId,
  });
}

/** Resolve the content type for the upload handshake (explicit override wins). */
export function guessUploadContentType(filename: string, override?: string): string {
  if (override !== undefined) {
    const trimmed = override.trim();
    if (!trimmed) throw new Error('mime type cannot be empty or whitespace-only');
    return trimmed;
  }
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Reject local file types known to fail Gemini Notebook's upload endpoint (HTML).
 * Throws with a remediation hint; callers surface it as a usage error.
 */
export function assertUploadFileSupported(filename: string, contentType: string): void {
  const ext = extname(filename).toLowerCase();
  const normalized = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (HTML_SUFFIXES.has(ext) || HTML_CONTENT_TYPES.has(normalized)) {
    throw new Error(
      `HTML file uploads are not supported by Gemini Notebook's upload endpoint: ${filename}. Convert the page to .txt, .md, or .pdf first, then retry.`,
    );
  }
}

/**
 * Validate a resumable upload URL handed back by the `start` response before we
 * stream bytes to it: it MUST target the configured upload endpoint (same
 * https host + path), carry no credentials, and include exactly one non-empty
 * `upload_id`. This stops a tampered/redirected start response from
 * exfiltrating the file to an attacker-controlled host.
 */
export function validateResumableUploadUrl(uploadUrl: string): string {
  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(uploadUrl);
    expected = new URL(getUploadUrl());
  } catch {
    throw new Error('Upload URL is not valid');
  }
  if (parsed.protocol !== 'https:') throw new Error('Upload URL must use https');
  if (parsed.username || parsed.password)
    throw new Error('Upload URL must not contain credentials');
  if (parsed.hostname !== expected.hostname || parsed.port !== expected.port) {
    throw new Error('Upload URL host is not trusted');
  }
  const norm = (p: string): string => `${(p || '/').replace(/\/+$/, '')}/`;
  if (norm(parsed.pathname) !== norm(expected.pathname)) {
    throw new Error('Upload URL path is not trusted');
  }
  const uploadIds = parsed.searchParams.getAll('upload_id').filter((v) => v.length > 0);
  if (uploadIds.length !== 1) {
    throw new Error('Upload URL must include exactly one non-empty upload_id');
  }
  return uploadUrl;
}

/**
 * Locate the new SOURCE_ID in an ADD_SOURCE_FILE response. The common shape is
 * the singleton envelope `[[id]]`; we scan recursively for a single id-looking
 * string (UUID or id-ish token) that isn't the filename. Returns undefined when
 * absent or ambiguous, so the caller can fall back to a source-list probe
 * rather than bind the wrong id.
 */
export function extractFileSourceId(result: unknown, filename: string): string | undefined {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || node == null) return;
    if (typeof node === 'string') {
      const candidate = node.trim();
      if (
        candidate &&
        candidate !== filename &&
        (UUID_RE.test(candidate) || looksLikeId(candidate))
      ) {
        found.add(candidate);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
    }
  };
  walk(result, 0);
  if (found.size === 1) return [...found][0];
  return undefined;
}

/** Heuristic for the non-UUID id fallback (mirrors upstream `_looks_like_id_string`). */
function looksLikeId(candidate: string): boolean {
  if (candidate.length < 4 || candidate.length > 1000) return false;
  if (/[ \t/]/.test(candidate)) return false;
  return /[0-9]/.test(candidate) || candidate.includes('-') || candidate.includes('_');
}
