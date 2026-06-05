/**
 * Public types — notebook, source, artifact dataclass equivalents.
 *
 * Ported from `notebooklm-py/src/notebooklm/_types/` (minimal subset for v0.1).
 */

import { SourceStatus } from './rpc/types.js';

export {
  ArtifactType,
  type Artifact,
  type GenerationStatus,
  type ReportSuggestion,
  parseArtifact,
  parseMindMapArtifact,
  extractArtifactUrl,
  mapArtifactKind,
  artifactMatchesType,
} from './artifactParse.js';

export interface Notebook {
  id: string;
  title: string;
  /** Epoch milliseconds, or undefined when API omits the slot. */
  createdAt?: number;
  sourcesCount: number;
  isOwner: boolean;
}

export interface Source {
  id: string;
  title?: string;
  url?: string;
  /** Raw API type code; usually 1=PDF, 2=URL, 3=text, 4=YouTube, etc. */
  typeCode?: number;
  /** SourceStatus enum value. */
  status: number;
  createdAt?: number;
}

/** A user-created note (distinct from AI-generated artifacts). */
export interface Note {
  id: string;
  notebookId: string;
  title: string;
  content: string;
}

/** A user a notebook is shared with. */
export interface SharedUser {
  email: string;
  /** SharePermission enum value (1=owner, 2=editor, 3=viewer). */
  permission: number;
  displayName?: string;
  avatarUrl?: string;
}

/** Current sharing configuration for a notebook. */
export interface ShareStatus {
  notebookId: string;
  isPublic: boolean;
  /** ShareAccess enum value (0=restricted, 1=anyone with link). */
  access: number;
  /** Shareable URL when public; undefined when restricted. */
  shareUrl?: string;
  sharedUsers: SharedUser[];
}

export interface ChatReference {
  /** Source UUID this reference points to. */
  sourceId: string;
  /** 1-indexed citation number, assigned in answer order (the inline [n] marker). */
  citationNumber?: number;
  /** The cited passage text from the source (null for structural-anchor citations). */
  citedText?: string;
  /** Start char position in the source's chunked index (paired with endChar). */
  startChar?: number;
  /** End char position in the source's chunked index. */
  endChar?: number;
  /** Internal chunk id (debugging, not user-facing). */
  chunkId?: string;
  /** Start position in the *answer text* of the span this citation supports. */
  answerStartChar?: number;
  /** End position (exclusive) in the answer text. */
  answerEndChar?: number;
  /** Server-side relevance score, 0.0–1.0. */
  score?: number;
}

export interface AskResult {
  answer: string;
  references: ChatReference[];
  /** Server-recorded conversation id, fetched via GET_LAST_CONVERSATION_ID after the ask. */
  conversationId?: string;
}

/** Parse the raw nested-array API payload into a typed `Notebook`. */
export function parseNotebook(data: unknown): Notebook {
  if (!Array.isArray(data)) {
    return { id: '', title: '', sourcesCount: 0, isOwner: true };
  }
  const rawTitle = typeof data[0] === 'string' ? data[0] : '';
  const title = rawTitle.replace(/^thought\n/, '').trim();
  const sources = data[1];
  const sourcesCount = Array.isArray(sources) ? sources.length : 0;
  const id = typeof data[2] === 'string' ? data[2] : '';

  let createdAt: number | undefined;
  const slot5 = data[5];
  if (Array.isArray(slot5) && slot5.length > 5) {
    const ts = slot5[5];
    if (Array.isArray(ts) && ts.length > 0) {
      const seconds = ts[0];
      if (typeof seconds === 'number') {
        createdAt = seconds * 1000;
      }
    }
  }
  const isOwner = Array.isArray(slot5) && slot5.length > 1 ? slot5[1] === false : true;

  const result: Notebook = {
    id,
    title,
    sourcesCount,
    isOwner,
  };
  if (createdAt !== undefined) result.createdAt = createdAt;
  return result;
}

/**
 * Parse a single source entry from a GET_NOTEBOOK response. Returns null for
 * shapes that don't match the expected layout (logged by caller).
 *
 * Entry shape: `[id_or_[id], title, metadata, ...]` where `metadata[3][2]`
 * sometimes carries the URL, and `metadata[3][3]` carries the type code.
 */
export function parseSource(src: unknown): Source | null {
  if (!Array.isArray(src) || src.length === 0) return null;

  // ID can be a bare string or `[id, ...]`
  const rawId = src[0];
  let id: string;
  if (typeof rawId === 'string') {
    id = rawId;
  } else if (Array.isArray(rawId) && typeof rawId[0] === 'string') {
    id = rawId[0];
  } else {
    return null;
  }

  const title = typeof src[1] === 'string' ? src[1] : undefined;
  const metadata = src[2];

  // URL precedence: metadata[7][5] (deep) or metadata[3][2]
  let url: string | undefined;
  if (Array.isArray(metadata)) {
    const m7 = metadata[7];
    if (Array.isArray(m7) && typeof m7[5] === 'string') url = m7[5];
    if (!url) {
      const m3 = metadata[3];
      if (Array.isArray(m3) && typeof m3[2] === 'string') url = m3[2];
    }
  }

  // Type code (1=PDF, 2=URL, 3=text, 4=YouTube...) at metadata[3][3]
  let typeCode: number | undefined;
  if (Array.isArray(metadata)) {
    const m3 = metadata[3];
    if (Array.isArray(m3) && typeof m3[3] === 'number') typeCode = m3[3];
  }

  // Status at src[3][1] (numeric SourceStatus)
  let status: number = SourceStatus.READY;
  const s3 = src[3];
  if (Array.isArray(s3) && typeof s3[1] === 'number') status = s3[1];

  // Created at — usually metadata[5][0] (seconds since epoch)
  let createdAt: number | undefined;
  if (Array.isArray(metadata)) {
    const m5 = metadata[5];
    if (Array.isArray(m5) && typeof m5[0] === 'number') createdAt = m5[0] * 1000;
  }

  const result: Source = { id, status };
  if (title !== undefined) result.title = title;
  if (url !== undefined) result.url = url;
  if (typeCode !== undefined) result.typeCode = typeCode;
  if (createdAt !== undefined) result.createdAt = createdAt;
  return result;
}
