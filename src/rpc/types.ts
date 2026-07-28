/**
 * RPC method IDs and enums for the NotebookLM batchexecute API.
 *
 * **Source of truth**: ported verbatim from
 * `notebooklm-py/src/notebooklm/rpc/types.py`. These obfuscated method IDs were
 * reverse-engineered from network traffic and Google changes them without
 * notice — keep this file in sync with the upstream Python project, or use
 * the `NOTEBOOKLM_RPC_OVERRIDES` env var (see `overrides.ts`) as an escape
 * hatch.
 */

import { getBaseUrl } from '../env.js';

// URL path for the streamed-chat endpoint. NOT a batchexecute RPC ID.
const QUERY_ENDPOINT_PATH =
  '/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.' +
  'LabsTailwindOrchestrationService/GenerateFreeFormStreamed';

export function getBatchexecuteUrl(): string {
  return `${getBaseUrl()}/_/LabsTailwindUi/data/batchexecute`;
}

export function getQueryUrl(): string {
  return `${getBaseUrl()}${QUERY_ENDPOINT_PATH}`;
}

export function getUploadUrl(): string {
  return `${getBaseUrl()}/upload/_/`;
}

/**
 * Obfuscated method identifiers used by the batchexecute API.
 *
 * Reverse-engineered from network traffic analysis. Google can change these
 * at any time; the `NOTEBOOKLM_RPC_OVERRIDES` env var lets users patch values
 * without waiting for a release.
 */
export const RPCMethod = {
  // Notebook operations
  LIST_NOTEBOOKS: 'wXbhsf',
  CREATE_NOTEBOOK: 'CCqFvf',
  GET_NOTEBOOK: 'rLM1Ne',
  RENAME_NOTEBOOK: 's0tc2d',
  DELETE_NOTEBOOK: 'WWINqb',

  // Source operations
  ADD_SOURCE: 'izAoDd',
  ADD_SOURCE_FILE: 'o4cbdc',
  DELETE_SOURCE: 'tGMBJ',
  GET_SOURCE: 'hizoJc',
  REFRESH_SOURCE: 'FLmJqe',
  CHECK_SOURCE_FRESHNESS: 'yR9Yof',
  UPDATE_SOURCE: 'b7Wfje',

  // Source labels (topic groupings of sources within a notebook)
  CREATE_LABEL: 'agX4Bc', // also AI auto-grouping ("Auto-label"/"Reorganize")
  LIST_LABELS: 'I3xc3c',
  UPDATE_LABEL: 'le8sX', // rename / set emoji / assign / unassign a source
  DELETE_LABEL: 'GyzE7e', // batch

  // Summary and query
  SUMMARIZE: 'VfAZjd',
  GET_SOURCE_GUIDE: 'tr032e',
  GET_SUGGESTED_REPORTS: 'ciyUvf',

  // Artifact operations
  CREATE_ARTIFACT: 'R7cb6c',
  LIST_ARTIFACTS: 'gArtLc',
  DELETE_ARTIFACT: 'V5N4be',
  RENAME_ARTIFACT: 'rc3d8d',
  EXPORT_ARTIFACT: 'Krh3pd',
  SHARE_ARTIFACT: 'RGP97b',
  GET_INTERACTIVE_HTML: 'v9rmvd',
  REVISE_SLIDE: 'KmcKPe',
  RETRY_ARTIFACT: 'Rytqqe', // -> in-place retry of a failed Studio artifact

  // Research
  START_FAST_RESEARCH: 'Ljjv0c',
  START_DEEP_RESEARCH: 'QA9ei',
  POLL_RESEARCH: 'e3bVqc',
  IMPORT_RESEARCH: 'LBwxtb',
  CANCEL_RESEARCH: 'Zbrupe', // -> CancelDiscoverSourcesJob

  // Note and mind-map operations
  GENERATE_MIND_MAP: 'yyryJe',
  CREATE_NOTE: 'CYK0Xb',
  GET_NOTES_AND_MIND_MAPS: 'cFji9',
  UPDATE_NOTE: 'cYAfTb',
  DELETE_NOTE: 'AH0mwd',

  // Conversation
  GET_LAST_CONVERSATION_ID: 'hPTbtc',
  GET_CONVERSATION_TURNS: 'khqZz',
  DELETE_CONVERSATION: 'J7Gthc',
  SUGGEST_PROMPTS: 'otmP3b', // -> GeneratePromptSuggestions

  // Sharing operations (notebook-level)
  SHARE_NOTEBOOK: 'QDyure',
  GET_SHARE_STATUS: 'JFMDGd',
  // SET_SHARE_ACCESS uses RENAME_NOTEBOOK (s0tc2d) with different params

  // Additional notebook operations
  REMOVE_RECENTLY_VIEWED: 'fejl7e',

  // User settings
  GET_USER_SETTINGS: 'ZwVcOc',
  SET_USER_SETTINGS: 'hT54vc',
  GET_USER_TIER: 'ozz5Z',
} as const;

export type RPCMethodName = keyof typeof RPCMethod;
export type RPCMethodId = (typeof RPCMethod)[RPCMethodName];

// =====================================================================
// Artifact enums — values must match the ints sent on the wire
// =====================================================================

/** Integer codes for artifact types used in CREATE_ARTIFACT (R7cb6c). */
export const ArtifactTypeCode = {
  AUDIO: 1,
  REPORT: 2, // briefing doc, study guide, blog post, etc.
  VIDEO: 3,
  QUIZ: 4, // also used for flashcards
  MIND_MAP: 5,
  INFOGRAPHIC: 7,
  SLIDE_DECK: 8,
  DATA_TABLE: 9,
} as const;
export type ArtifactTypeCode = (typeof ArtifactTypeCode)[keyof typeof ArtifactTypeCode];

/** Processing status of an artifact (artifact_data[4] in responses). */
export const ArtifactStatus = {
  PROCESSING: 1,
  PENDING: 2,
  COMPLETED: 3,
  FAILED: 4,
} as const;
export type ArtifactStatus = (typeof ArtifactStatus)[keyof typeof ArtifactStatus];

const ARTIFACT_STATUS_LABEL: Record<number, string> = {
  [ArtifactStatus.PROCESSING]: 'in_progress',
  [ArtifactStatus.PENDING]: 'pending',
  [ArtifactStatus.COMPLETED]: 'completed',
  [ArtifactStatus.FAILED]: 'failed',
};

export function artifactStatusToString(code: number): string {
  return ARTIFACT_STATUS_LABEL[code] ?? 'unknown';
}

// =====================================================================
// Source status
// =====================================================================

export const SourceStatus = {
  PROCESSING: 1,
  READY: 2,
  ERROR: 3,
  PREPARING: 5,
} as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];

const SOURCE_STATUS_LABEL: Record<number, string> = {
  [SourceStatus.PROCESSING]: 'processing',
  [SourceStatus.READY]: 'ready',
  [SourceStatus.ERROR]: 'error',
  [SourceStatus.PREPARING]: 'preparing',
};

export function sourceStatusToString(code: number): string {
  return SOURCE_STATUS_LABEL[code] ?? 'unknown';
}

// =====================================================================
// Audio / video / quiz / infographic / slide / share enums
// =====================================================================

export const AudioFormat = { DEEP_DIVE: 1, BRIEF: 2, CRITIQUE: 3, DEBATE: 4 } as const;
export const AudioLength = { SHORT: 1, DEFAULT: 2, LONG: 3 } as const;

export const VideoFormat = { EXPLAINER: 1, BRIEF: 2, CINEMATIC: 3, SHORT: 4 } as const;
// Style codes are the live web-bundle values, not a tidy 1..N sequence — Google
// assigns them out of order. Corrected against notebooklm-py (de58d62); the old
// sequential guess sent e.g. ANIME=6, which the backend silently reads as
// WATERCOLOR. CUSTOM is the proto-default 0 and is serialized as null on the
// wire (see generateVideo), with the visual prompt carried in a separate slot.
export const VideoStyle = {
  AUTO_SELECT: 1,
  CUSTOM: 0,
  CLASSIC: 2,
  WHITEBOARD: 3,
  KAWAII: 9,
  ANIME: 7,
  WATERCOLOR: 6,
  RETRO_PRINT: 8,
  HERITAGE: 4,
  PAPER_CRAFT: 5,
} as const;

export const QuizQuantity = { FEWER: 1, STANDARD: 2, MORE: 2 } as const;
export const QuizDifficulty = { EASY: 1, MEDIUM: 2, HARD: 3 } as const;

export const InfographicOrientation = { LANDSCAPE: 1, PORTRAIT: 2, SQUARE: 3 } as const;
export const InfographicDetail = { CONCISE: 1, STANDARD: 2, DETAILED: 3 } as const;
export const InfographicStyle = {
  AUTO_SELECT: 1,
  SKETCH_NOTE: 2,
  PROFESSIONAL: 3,
  BENTO_GRID: 4,
  EDITORIAL: 5,
  INSTRUCTIONAL: 6,
  BRICKS: 7,
  CLAY: 8,
  ANIME: 9,
  KAWAII: 10,
  SCIENTIFIC: 11,
} as const;

export const SlideDeckFormat = { DETAILED_DECK: 1, PRESENTER_SLIDES: 2 } as const;
export const SlideDeckLength = { DEFAULT: 1, SHORT: 2 } as const;

export type AudioFormat = (typeof AudioFormat)[keyof typeof AudioFormat];
export type AudioLength = (typeof AudioLength)[keyof typeof AudioLength];
export type VideoFormat = (typeof VideoFormat)[keyof typeof VideoFormat];
export type VideoStyle = (typeof VideoStyle)[keyof typeof VideoStyle];
export type QuizQuantity = (typeof QuizQuantity)[keyof typeof QuizQuantity];
export type QuizDifficulty = (typeof QuizDifficulty)[keyof typeof QuizDifficulty];
export type InfographicOrientation =
  (typeof InfographicOrientation)[keyof typeof InfographicOrientation];
export type InfographicDetail = (typeof InfographicDetail)[keyof typeof InfographicDetail];
export type InfographicStyle = (typeof InfographicStyle)[keyof typeof InfographicStyle];
export type SlideDeckFormat = (typeof SlideDeckFormat)[keyof typeof SlideDeckFormat];
export type SlideDeckLength = (typeof SlideDeckLength)[keyof typeof SlideDeckLength];

/**
 * Report subtypes. All reports use ArtifactTypeCode.REPORT (2); the distinction
 * is carried by the title/description/prompt config baked into the request.
 */
export const ReportFormat = {
  BRIEFING_DOC: 'briefing_doc',
  STUDY_GUIDE: 'study_guide',
  BLOG_POST: 'blog_post',
  CUSTOM: 'custom',
} as const;
export type ReportFormat = (typeof ReportFormat)[keyof typeof ReportFormat];

export const ChatGoal = { DEFAULT: 1, CUSTOM: 2, LEARNING_GUIDE: 3 } as const;
export const ChatResponseLength = { DEFAULT: 1, LONGER: 4, SHORTER: 5 } as const;

export const ShareAccess = { RESTRICTED: 0, ANYONE_WITH_LINK: 1 } as const;
export const ShareViewLevel = { FULL_NOTEBOOK: 0, CHAT_ONLY: 1 } as const;
export const SharePermission = { OWNER: 1, EDITOR: 2, VIEWER: 3 } as const;

export const ExportType = { DOCS: 1, SHEETS: 2 } as const;
