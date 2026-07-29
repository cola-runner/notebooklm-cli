/**
 * Artifact dataclass equivalents + raw-response parsing.
 *
 * Ported from `notebooklm-py/src/notebooklm/_types/artifacts.py`. The nested
 * index positions below are reverse-engineered from `LIST_ARTIFACTS` (gArtLc)
 * responses and are position-sensitive — keep them in sync with upstream.
 */

import { ArtifactStatus, ArtifactTypeCode, artifactStatusToString } from './rpc/types.js';

/** User-facing artifact kinds. Hides internal variant complexity (quiz vs flashcards). */
export const ArtifactType = {
  AUDIO: 'audio',
  VIDEO: 'video',
  REPORT: 'report',
  QUIZ: 'quiz',
  FLASHCARDS: 'flashcards',
  MIND_MAP: 'mind_map',
  INFOGRAPHIC: 'infographic',
  SLIDE_DECK: 'slide_deck',
  DATA_TABLE: 'data_table',
  UNKNOWN: 'unknown',
} as const;
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

/** A Gemini Notebook studio artifact (audio, video, report, quiz, …). */
export interface Artifact {
  id: string;
  title: string;
  /** ArtifactStatus enum value: 1=processing, 2=pending, 3=completed, 4=failed. */
  status: number;
  /** Human-facing kind, derived from the internal type code + variant. */
  kind: ArtifactType;
  /** Epoch milliseconds, or undefined when the API omits the slot. */
  createdAt?: number;
  /** Download URL when available (PDF URL for slide decks). */
  url?: string;
  /** Raw ArtifactTypeCode int — needed for selection/filtering. */
  artifactType: number;
  /** For type 4: 1=flashcards, 2=quiz. */
  variant?: number;
  /** Free-text prompt that generated the artifact, when stored by Gemini Notebook. */
  generationPrompt?: string;
}

/** Status of an in-flight or finished generation task. task_id === artifact id. */
export interface GenerationStatus {
  taskId: string;
  /** "pending" | "in_progress" | "completed" | "failed" | "not_found" | "unknown". */
  status: string;
  url?: string;
  error?: string;
  /** e.g. "USER_DISPLAYABLE_ERROR" for rate limits. */
  errorCode?: string;
}

/** AI-suggested report format for a notebook. */
export interface ReportSuggestion {
  title: string;
  description: string;
  prompt: string;
  /** 1=beginner, 2=advanced. */
  audienceLevel: number;
}

const ARTIFACT_TYPE_CODE_MAP: Record<number, ArtifactType> = {
  [ArtifactTypeCode.AUDIO]: ArtifactType.AUDIO,
  [ArtifactTypeCode.REPORT]: ArtifactType.REPORT,
  [ArtifactTypeCode.VIDEO]: ArtifactType.VIDEO,
  [ArtifactTypeCode.MIND_MAP]: ArtifactType.MIND_MAP,
  [ArtifactTypeCode.INFOGRAPHIC]: ArtifactType.INFOGRAPHIC,
  [ArtifactTypeCode.SLIDE_DECK]: ArtifactType.SLIDE_DECK,
  [ArtifactTypeCode.DATA_TABLE]: ArtifactType.DATA_TABLE,
};

const PROMPT_PATHS: Record<number, readonly number[]> = {
  [ArtifactTypeCode.AUDIO]: [6, 1, 0],
  [ArtifactTypeCode.REPORT]: [7, 1, 5],
  [ArtifactTypeCode.VIDEO]: [8, 2, 2],
  [ArtifactTypeCode.QUIZ]: [9, 1, 2],
  [ArtifactTypeCode.INFOGRAPHIC]: [14, 0, 0],
  [ArtifactTypeCode.SLIDE_DECK]: [16, 0, 0],
  [ArtifactTypeCode.DATA_TABLE]: [18, 1, 0],
};

/** Extract the type-specific free-text prompt from a LIST_ARTIFACTS row. */
export function extractArtifactGenerationPrompt(
  data: unknown[],
  artifactType: number,
): string | undefined {
  const path = PROMPT_PATHS[artifactType];
  if (!path) return undefined;
  let value: unknown = data;
  for (const index of path) {
    if (!Array.isArray(value) || index >= value.length) return undefined;
    value = value[index];
  }
  return typeof value === 'string' ? value : undefined;
}

/** Map an internal (typeCode, variant) pair to a user-facing ArtifactType. */
export function mapArtifactKind(artifactType: number, variant: number | undefined): ArtifactType {
  if (artifactType === ArtifactTypeCode.QUIZ) {
    if (variant === 1) return ArtifactType.FLASHCARDS;
    if (variant === 2) return ArtifactType.QUIZ;
    return ArtifactType.UNKNOWN;
  }
  return ARTIFACT_TYPE_CODE_MAP[artifactType] ?? ArtifactType.UNKNOWN;
}

function isValidArtifactUrl(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function extractAudioUrl(data: unknown[]): string | undefined {
  const slot6 = data[6];
  if (!Array.isArray(slot6) || slot6.length <= 5) return undefined;
  const mediaList = slot6[5];
  if (!Array.isArray(mediaList)) return undefined;
  // Prefer the audio/mp4 entry.
  for (const item of mediaList) {
    if (
      Array.isArray(item) &&
      item.length > 2 &&
      item[2] === 'audio/mp4' &&
      isValidArtifactUrl(item[0])
    ) {
      return item[0];
    }
  }
  for (const item of mediaList) {
    if (Array.isArray(item) && item.length > 0 && isValidArtifactUrl(item[0])) return item[0];
  }
  return undefined;
}

function extractVideoUrl(data: unknown[]): string | undefined {
  const slot8 = data[8];
  if (!Array.isArray(slot8)) return undefined;
  let fallback: string | undefined;
  for (const mediaList of slot8) {
    if (!Array.isArray(mediaList)) continue;
    for (const item of mediaList) {
      if (!Array.isArray(item) || item.length === 0 || !isValidArtifactUrl(item[0])) continue;
      if (fallback === undefined) fallback = item[0];
      if (item.length > 2 && item[2] === 'video/mp4') {
        if (item.length > 1 && item[1] === 4) return item[0];
        fallback = item[0];
      }
    }
  }
  return fallback;
}

function extractInfographicUrl(data: unknown[]): string | undefined {
  for (const item of data) {
    if (!Array.isArray(item) || item.length <= 2) continue;
    const content = item[2];
    if (!Array.isArray(content) || content.length === 0) continue;
    const firstContent = content[0];
    if (!Array.isArray(firstContent) || firstContent.length <= 1) continue;
    const imgData = firstContent[1];
    if (Array.isArray(imgData) && imgData.length > 0 && isValidArtifactUrl(imgData[0])) {
      return imgData[0];
    }
  }
  return undefined;
}

function extractSlideDeckUrl(data: unknown[]): string | undefined {
  const slot16 = data[16];
  if (Array.isArray(slot16) && slot16.length > 3 && isValidArtifactUrl(slot16[3])) {
    return slot16[3];
  }
  return undefined;
}

/** Extract a public download URL from known artifact response shapes. */
export function extractArtifactUrl(
  data: unknown[],
  artifactType: number | undefined,
): string | undefined {
  if (artifactType === ArtifactTypeCode.AUDIO) return extractAudioUrl(data);
  if (artifactType === ArtifactTypeCode.VIDEO) return extractVideoUrl(data);
  if (artifactType === ArtifactTypeCode.INFOGRAPHIC) return extractInfographicUrl(data);
  if (artifactType === ArtifactTypeCode.SLIDE_DECK) return extractSlideDeckUrl(data);
  return undefined;
}

/** Parse a studio artifact row from a LIST_ARTIFACTS response. */
export function parseArtifact(data: unknown): Artifact | null {
  if (!Array.isArray(data) || data.length === 0) return null;

  const id = data.length > 0 ? String(data[0] ?? '') : '';
  const title = data.length > 1 && typeof data[1] === 'string' ? data[1] : String(data[1] ?? '');
  const artifactType = data.length > 2 && typeof data[2] === 'number' ? data[2] : 0;
  const status = data.length > 4 && typeof data[4] === 'number' ? data[4] : 0;

  let createdAt: number | undefined;
  const slot15 = data[15];
  if (Array.isArray(slot15) && slot15.length > 0 && typeof slot15[0] === 'number') {
    createdAt = slot15[0] * 1000;
  }

  // Variant code at data[9][1][0] distinguishes quiz (2) from flashcards (1).
  let variant: number | undefined;
  const slot9 = data[9];
  if (Array.isArray(slot9) && slot9.length > 1) {
    const options = slot9[1];
    if (Array.isArray(options) && options.length > 0 && typeof options[0] === 'number') {
      variant = options[0];
    }
  }

  const url = extractArtifactUrl(data, artifactType);
  const generationPrompt = extractArtifactGenerationPrompt(data, artifactType);

  const artifact: Artifact = {
    id,
    title,
    status,
    artifactType,
    kind: mapArtifactKind(artifactType, variant),
  };
  if (createdAt !== undefined) artifact.createdAt = createdAt;
  if (url !== undefined) artifact.url = url;
  if (variant !== undefined) artifact.variant = variant;
  if (generationPrompt !== undefined) artifact.generationPrompt = generationPrompt;
  return artifact;
}

/**
 * Parse a mind-map row (stored in the notes system). Returns null for deleted
 * entries (`[id, null, 2]`).
 */
export function parseMindMapArtifact(data: unknown): Artifact | null {
  if (!Array.isArray(data) || data.length < 1) return null;
  const mindMapId = String(data[0] ?? '');

  if (data.length >= 3 && data[1] === null && data[2] === 2) return null; // deleted

  let title = '';
  let createdAt: number | undefined;
  const inner = data[1];
  if (Array.isArray(inner)) {
    if (inner.length > 4 && typeof inner[4] === 'string') title = inner[4];
    if (inner.length > 2 && Array.isArray(inner[2]) && inner[2].length > 2) {
      const tsData = inner[2][2];
      if (Array.isArray(tsData) && tsData.length > 0 && typeof tsData[0] === 'number') {
        createdAt = tsData[0] * 1000;
      }
    }
  }

  const artifact: Artifact = {
    id: mindMapId,
    title,
    status: ArtifactStatus.COMPLETED, // mind maps are "completed" once created
    artifactType: ArtifactTypeCode.MIND_MAP,
    kind: ArtifactType.MIND_MAP,
  };
  if (createdAt !== undefined) artifact.createdAt = createdAt;
  return artifact;
}

/** Whether an artifact matches a requested filter kind (handles quiz/flashcard variants). */
export function artifactMatchesType(
  artifact: Artifact,
  artifactType: ArtifactType | undefined,
): boolean {
  if (artifactType === undefined) return true;
  if (artifactType === ArtifactType.QUIZ) {
    return artifact.artifactType === ArtifactTypeCode.QUIZ && artifact.variant === 2;
  }
  if (artifactType === ArtifactType.FLASHCARDS) {
    return artifact.artifactType === ArtifactTypeCode.QUIZ && artifact.variant === 1;
  }
  return mapArtifactKind(artifact.artifactType, artifact.variant) === artifactType;
}

/** Status helpers mirroring py GenerationStatus / Artifact properties. */
export function isCompleted(status: number): boolean {
  return status === ArtifactStatus.COMPLETED;
}

/** Human-readable status string for an artifact status code. */
export function artifactStatusName(status: number): string {
  return artifactStatusToString(status);
}
