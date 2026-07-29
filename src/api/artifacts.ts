/**
 * Artifacts API — generate, list, poll, download, and manage Gemini Notebook
 * studio content (audio overviews, videos, reports, quizzes, flashcards,
 * infographics, slide decks, data tables).
 *
 * Ported from `notebooklm-py`'s `_artifacts.py` + `_artifact_generation.py` +
 * `_artifact_listing.py` + `_artifact_polling.py` + `_artifact_downloads.py`.
 * The nested request/response array positions are position-sensitive — keep
 * them aligned with the upstream Python implementation.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  type InteractiveFormat,
  extractAppData,
  formatInteractiveContent,
  parseDataTable,
  toCsv,
} from '../artifactFormatters.js';
import {
  type Artifact,
  type ArtifactType,
  type GenerationStatus,
  type ReportSuggestion,
  artifactMatchesType,
  extractArtifactUrl,
  parseArtifact,
} from '../artifactParse.js';
import { getDefaultLanguage } from '../env.js';
import { nestSourceIds } from '../rpc/encoder.js';
import {
  ArtifactDownloadError,
  ArtifactError,
  ArtifactNotFoundError,
  ArtifactNotReadyError,
  ArtifactParseError,
  RPCError,
} from '../rpc/errors.js';
import {
  ArtifactStatus,
  ArtifactTypeCode,
  type AudioFormat,
  type AudioLength,
  InfographicDetail,
  InfographicOrientation,
  type InfographicStyle,
  type QuizDifficulty,
  type QuizQuantity,
  ReportFormat,
  type SlideDeckFormat,
  type SlideDeckLength,
  type VideoFormat,
  VideoFormat as VideoFormatEnum,
  type VideoStyle,
  VideoStyle as VideoStyleEnum,
  artifactStatusToString,
} from '../rpc/types.js';
import type { Session } from '../session/session.js';
import type { NotebooksAPI } from './notebooks.js';

const MEDIA_TYPES = new Set<number>([
  ArtifactTypeCode.AUDIO,
  ArtifactTypeCode.VIDEO,
  ArtifactTypeCode.INFOGRAPHIC,
  ArtifactTypeCode.SLIDE_DECK,
]);

const REPORT_CONFIGS: Record<string, { title: string; description: string; prompt: string }> = {
  [ReportFormat.BRIEFING_DOC]: {
    title: 'Briefing Doc',
    description: 'Key insights and important quotes',
    prompt:
      'Create a comprehensive briefing document that includes an Executive Summary, ' +
      'detailed analysis of key themes, important quotes with context, and actionable insights.',
  },
  [ReportFormat.STUDY_GUIDE]: {
    title: 'Study Guide',
    description: 'Short-answer quiz, essay questions, glossary',
    prompt:
      'Create a comprehensive study guide that includes key concepts, short-answer practice ' +
      'questions, essay prompts for deeper exploration, and a glossary of important terms.',
  },
  [ReportFormat.BLOG_POST]: {
    title: 'Blog Post',
    description: 'Insightful takeaways in readable article format',
    prompt:
      'Write an engaging blog post that presents the key insights in an accessible, ' +
      'reader-friendly format. Include an attention-grabbing introduction, well-organized ' +
      'sections, and a compelling conclusion with takeaways.',
  },
};

export interface AudioOptions {
  sourceIds?: string[];
  language?: string;
  instructions?: string;
  audioFormat?: AudioFormat;
  audioLength?: AudioLength;
}
export interface VideoOptions {
  sourceIds?: string[];
  language?: string;
  instructions?: string;
  videoFormat?: VideoFormat;
  videoStyle?: VideoStyle;
  stylePrompt?: string;
}
export interface ReportOptions {
  reportFormat?: ReportFormat;
  sourceIds?: string[];
  language?: string;
  customPrompt?: string;
  extraInstructions?: string;
}
export interface QuizOptions {
  sourceIds?: string[];
  instructions?: string;
  quantity?: QuizQuantity;
  difficulty?: QuizDifficulty;
}
export interface InfographicOptions {
  sourceIds?: string[];
  language?: string;
  instructions?: string;
  orientation?: InfographicOrientation;
  detailLevel?: InfographicDetail;
  style?: InfographicStyle;
}
export interface SlideDeckOptions {
  sourceIds?: string[];
  language?: string;
  instructions?: string;
  slideFormat?: SlideDeckFormat;
  slideLength?: SlideDeckLength;
}
export interface DataTableOptions {
  sourceIds?: string[];
  language?: string;
  instructions?: string;
}
export interface WaitOptions {
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
  maxNotFound?: number;
  onStatusChange?: (status: GenerationStatus) => void;
}

export class ArtifactsAPI {
  constructor(
    private readonly session: Session,
    private readonly notebooks: NotebooksAPI,
  ) {}

  // ===========================================================================
  // Generation
  // ===========================================================================

  async generateAudio(notebookId: string, opts: AudioOptions = {}): Promise<GenerationStatus> {
    const language = opts.language ?? getDefaultLanguage();
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const double = nestSourceIds(sourceIds, 1);
    const params = [
      [2],
      notebookId,
      [
        null,
        null,
        ArtifactTypeCode.AUDIO,
        triple,
        null,
        null,
        [
          null,
          [
            opts.instructions ?? null,
            opts.audioLength ?? null,
            null,
            double,
            language,
            null,
            opts.audioFormat ?? null,
          ],
        ],
      ],
    ];
    return this.callGenerate(notebookId, params);
  }

  async generateVideo(notebookId: string, opts: VideoOptions = {}): Promise<GenerationStatus> {
    const language = opts.language ?? getDefaultLanguage();
    const stylePrompt = opts.stylePrompt?.trim() || undefined;
    if (opts.videoFormat === VideoFormatEnum.CINEMATIC && stylePrompt) {
      throw new ArtifactError('style_prompt is not supported for cinematic videos');
    }
    if (
      opts.videoFormat === VideoFormatEnum.SHORT &&
      ((opts.videoStyle !== undefined && opts.videoStyle !== VideoStyleEnum.AUTO_SELECT) ||
        stylePrompt)
    ) {
      throw new ArtifactError(
        'videoStyle and stylePrompt are not supported for short videos ' +
          '(short has a fixed visual style)',
      );
    }
    if (opts.videoStyle === VideoStyleEnum.CUSTOM && !stylePrompt) {
      throw new ArtifactError('style_prompt is required when videoStyle is CUSTOM');
    }
    if (stylePrompt && opts.videoStyle !== VideoStyleEnum.CUSTOM) {
      throw new ArtifactError('style_prompt requires videoStyle=CUSTOM');
    }
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const double = nestSourceIds(sourceIds, 1);
    // CUSTOM is the proto-default (0); the live web UI omits it (sends null) and
    // carries the visual prompt in the trailing slot. Any other style sends its
    // code; an unset style defaults to AUTO_SELECT, not null. (notebooklm-py de58d62)
    const styleCode =
      opts.videoStyle === VideoStyleEnum.CUSTOM
        ? null
        : (opts.videoStyle ?? VideoStyleEnum.AUTO_SELECT);
    const videoConfig: unknown[] = [
      double,
      language,
      opts.instructions ?? null,
      null,
      opts.videoFormat ?? null,
      styleCode,
    ];
    if (opts.videoStyle === VideoStyleEnum.CUSTOM && stylePrompt) videoConfig.push(stylePrompt);
    const params = [
      [2],
      notebookId,
      [
        null,
        null,
        ArtifactTypeCode.VIDEO,
        triple,
        null,
        null,
        null,
        null,
        [null, null, videoConfig],
      ],
    ];
    return this.callGenerate(notebookId, params);
  }

  async generateCinematicVideo(
    notebookId: string,
    opts: Omit<VideoOptions, 'videoFormat' | 'videoStyle' | 'stylePrompt'> = {},
  ): Promise<GenerationStatus> {
    const language = opts.language ?? getDefaultLanguage();
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const double = nestSourceIds(sourceIds, 1);
    const params = [
      [2],
      notebookId,
      [
        null,
        null,
        ArtifactTypeCode.VIDEO,
        triple,
        null,
        null,
        null,
        null,
        [
          null,
          null,
          [double, language, opts.instructions ?? null, null, VideoFormatEnum.CINEMATIC],
        ],
      ],
    ];
    return this.callGenerate(notebookId, params);
  }

  async generateReport(notebookId: string, opts: ReportOptions = {}): Promise<GenerationStatus> {
    const reportFormat = opts.reportFormat ?? ReportFormat.BRIEFING_DOC;
    const language = opts.language ?? getDefaultLanguage();
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));

    let title: string;
    let description: string;
    let prompt: string;
    if (reportFormat === ReportFormat.CUSTOM) {
      title = 'Custom Report';
      description = 'Custom format';
      prompt = opts.customPrompt ?? 'Create a report based on the provided sources.';
    } else {
      const config = REPORT_CONFIGS[reportFormat] ?? REPORT_CONFIGS[ReportFormat.BRIEFING_DOC]!;
      title = config.title;
      description = config.description;
      prompt = opts.extraInstructions
        ? `${config.prompt}\n\n${opts.extraInstructions}`
        : config.prompt;
    }

    const triple = nestSourceIds(sourceIds, 2);
    const double = nestSourceIds(sourceIds, 1);
    const params = [
      [2],
      notebookId,
      [
        null,
        null,
        ArtifactTypeCode.REPORT,
        triple,
        null,
        null,
        null,
        [null, [title, description, null, double, language, prompt, null, true]],
      ],
    ];
    return this.callGenerate(notebookId, params);
  }

  async generateStudyGuide(
    notebookId: string,
    opts: Omit<ReportOptions, 'reportFormat' | 'customPrompt'> = {},
  ): Promise<GenerationStatus> {
    return this.generateReport(notebookId, { ...opts, reportFormat: ReportFormat.STUDY_GUIDE });
  }

  async generateQuiz(notebookId: string, opts: QuizOptions = {}): Promise<GenerationStatus> {
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const params = [
      [2],
      notebookId,
      [
        null,
        null,
        ArtifactTypeCode.QUIZ,
        triple,
        null,
        null,
        null,
        null,
        null,
        [
          null,
          [
            2,
            null,
            opts.instructions ?? null,
            null,
            null,
            null,
            null,
            [opts.quantity ?? null, opts.difficulty ?? null],
          ],
        ],
      ],
    ];
    return this.callGenerate(notebookId, params);
  }

  async generateFlashcards(notebookId: string, opts: QuizOptions = {}): Promise<GenerationStatus> {
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const params = [
      [2],
      notebookId,
      [
        null,
        null,
        ArtifactTypeCode.QUIZ,
        triple,
        null,
        null,
        null,
        null,
        null,
        [
          null,
          [
            1,
            null,
            opts.instructions ?? null,
            null,
            null,
            null,
            [opts.difficulty ?? null, opts.quantity ?? null],
          ],
        ],
      ],
    ];
    return this.callGenerate(notebookId, params);
  }

  async generateInfographic(
    notebookId: string,
    opts: InfographicOptions = {},
  ): Promise<GenerationStatus> {
    const language = opts.language ?? getDefaultLanguage();
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    // The backend rejects an infographic request whose orientation/detail are
    // both null — CREATE_ARTIFACT then returns null (no artifact_id) and the
    // stub artifact lands in FAILED. Default to the web UI's choices (landscape,
    // standard detail) so a bare `generate infographic` works. style may stay
    // null (the backend picks one).
    const orientation = opts.orientation ?? InfographicOrientation.LANDSCAPE;
    const detailLevel = opts.detailLevel ?? InfographicDetail.STANDARD;
    const config = [
      [opts.instructions ?? null, language, null, orientation, detailLevel, opts.style ?? null],
    ];
    const inner = [null, null, ArtifactTypeCode.INFOGRAPHIC, triple, ...nulls(10), config];
    return this.callGenerate(notebookId, [[2], notebookId, inner]);
  }

  async generateSlideDeck(
    notebookId: string,
    opts: SlideDeckOptions = {},
  ): Promise<GenerationStatus> {
    const language = opts.language ?? getDefaultLanguage();
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const config = [
      [opts.instructions ?? null, language, opts.slideFormat ?? null, opts.slideLength ?? null],
    ];
    // Config sits at inner index 16 (positions 4–15 are null padding); mirrors
    // notebooklm-py generate_slide_deck. Off-by-one here makes the backend drop
    // the config and return no artifact_id.
    const inner = [null, null, ArtifactTypeCode.SLIDE_DECK, triple, ...nulls(12), config];
    return this.callGenerate(notebookId, [[2], notebookId, inner]);
  }

  async generateDataTable(
    notebookId: string,
    opts: DataTableOptions = {},
  ): Promise<GenerationStatus> {
    const language = opts.language ?? getDefaultLanguage();
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const triple = nestSourceIds(sourceIds, 2);
    const config = [null, [opts.instructions ?? null, language]];
    // Config sits at inner index 18 (positions 4–17 are null padding); mirrors
    // notebooklm-py generate_data_table. Off-by-one here makes the backend drop
    // the config and return no artifact_id.
    const inner = [null, null, ArtifactTypeCode.DATA_TABLE, triple, ...nulls(14), config];
    return this.callGenerate(notebookId, [[2], notebookId, inner]);
  }

  /** Revise a single slide in a completed slide deck. */
  async reviseSlide(
    notebookId: string,
    artifactId: string,
    slideIndex: number,
    prompt: string,
  ): Promise<GenerationStatus> {
    if (slideIndex < 0) throw new ArtifactError(`slideIndex must be >= 0, got ${slideIndex}`);
    const params = [[2], artifactId, [[[slideIndex, prompt]]]];
    try {
      const result = await this.session.call<unknown>('REVISE_SLIDE', params, { allowNull: true });
      return parseGenerationResult(result);
    } catch (err) {
      const failed = generationFailureFromRpcError(err);
      if (failed) return failed;
      throw err;
    }
  }

  /** Get AI-suggested report formats for a notebook. */
  async suggestReports(notebookId: string): Promise<ReportSuggestion[]> {
    const result = await this.session.call<unknown>('GET_SUGGESTED_REPORTS', [[2], notebookId], {
      allowNull: true,
    });
    if (!Array.isArray(result) || result.length === 0) return [];
    const items = Array.isArray(result[0]) ? result[0] : result;
    const suggestions: ReportSuggestion[] = [];
    for (const item of items) {
      if (Array.isArray(item) && item.length >= 5) {
        suggestions.push({
          title: typeof item[0] === 'string' ? item[0] : '',
          description: typeof item[1] === 'string' ? item[1] : '',
          prompt: typeof item[4] === 'string' ? item[4] : '',
          audienceLevel: item.length > 5 && typeof item[5] === 'number' ? item[5] : 2,
        });
      }
    }
    return suggestions;
  }

  // ===========================================================================
  // List / Get
  // ===========================================================================

  /** List studio artifacts in a notebook, optionally filtered by kind. */
  async list(notebookId: string, artifactType?: ArtifactType): Promise<Artifact[]> {
    const raw = await this.listRaw(notebookId);
    const artifacts: Artifact[] = [];
    for (const row of raw) {
      const artifact = parseArtifact(row);
      if (artifact && artifactMatchesType(artifact, artifactType)) artifacts.push(artifact);
    }
    return artifacts;
  }

  async get(notebookId: string, artifactId: string): Promise<Artifact | undefined> {
    const artifacts = await this.list(notebookId);
    return artifacts.find((a) => a.id === artifactId);
  }

  /** Return the free-text prompt that generated an artifact, when one was stored. */
  async getPrompt(notebookId: string, artifactId: string): Promise<string | null> {
    const artifact = await this.get(notebookId, artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(`artifact not found: ${artifactId}`);
    }
    return artifact.generationPrompt ?? null;
  }

  // ===========================================================================
  // Polling
  // ===========================================================================

  /** Poll a single generation task's status. Returns status="not_found" if absent. */
  async pollStatus(notebookId: string, taskId: string): Promise<GenerationStatus> {
    const raw = await this.listRaw(notebookId);
    for (const art of raw) {
      if (!Array.isArray(art) || art.length === 0 || art[0] !== taskId) continue;
      let statusCode = art.length > 4 && typeof art[4] === 'number' ? art[4] : 0;
      const artifactType = art.length > 2 && typeof art[2] === 'number' ? art[2] : 0;

      // The API may report COMPLETED before media URLs are populated.
      if (statusCode === ArtifactStatus.COMPLETED && !isMediaReady(art, artifactType)) {
        statusCode = ArtifactStatus.PROCESSING;
      }

      const status = artifactStatusToString(statusCode);
      const out: GenerationStatus = { taskId, status };
      if (status === 'failed') {
        const error = extractArtifactError(art);
        if (error) out.error = error;
      }
      const url = extractArtifactUrl(art, artifactType);
      if (url) out.url = url;
      return out;
    }
    return { taskId, status: 'not_found' };
  }

  /**
   * Poll until a generation task completes/fails. Uses exponential backoff.
   *
   * A sustained run of "not_found" is treated as failure ONLY before the
   * artifact has ever been observed in-progress — that's the quota-rejection
   * case where the server never materializes the artifact. Once we've seen it
   * processing, later "not_found" responses are treated as transient: audio
   * generation in particular drops the row from LIST_ARTIFACTS mid-synthesis
   * and re-adds it as COMPLETED, so we keep polling until completion or timeout.
   */
  async waitForCompletion(
    notebookId: string,
    taskId: string,
    opts: WaitOptions = {},
  ): Promise<GenerationStatus> {
    const initial = opts.initialIntervalMs ?? 2_000;
    const max = opts.maxIntervalMs ?? 10_000;
    const timeout = opts.timeoutMs ?? 300_000;
    const maxNotFound = opts.maxNotFound ?? 5;
    const minNotFoundWindowMs = 10_000;

    const start = Date.now();
    let interval = initial;
    let consecutiveNotFound = 0;
    let totalNotFound = 0;
    let firstNotFoundAt: number | null = null;
    let lastEmitted: string | null = null;
    let everSeenProcessing = false;

    while (true) {
      const status = await this.pollStatus(notebookId, taskId);
      if (status.status !== lastEmitted) {
        lastEmitted = status.status;
        opts.onStatusChange?.(status);
      }
      if (status.status === 'completed' || status.status === 'failed') return status;
      if (status.status === 'in_progress' || status.status === 'pending') {
        everSeenProcessing = true;
      }

      // Only fail on "not_found" if the artifact never appeared (quota reject).
      // After it's been seen processing, a vanished row means "still working".
      if (status.status === 'not_found' && !everSeenProcessing) {
        consecutiveNotFound += 1;
        totalNotFound += 1;
        const now = Date.now();
        if (firstNotFoundAt === null) firstNotFoundAt = now;
        const elapsedNotFound = now - firstNotFoundAt;
        const consecutiveTrigger =
          consecutiveNotFound >= maxNotFound && elapsedNotFound >= minNotFoundWindowMs;
        const totalTrigger = totalNotFound >= maxNotFound * 2;
        if (consecutiveTrigger || totalTrigger) {
          const failed: GenerationStatus = {
            taskId,
            status: 'failed',
            error:
              'Generation failed: artifact was removed by the server. This may indicate a ' +
              'daily quota/rate limit was exceeded, an invalid notebook ID, or a transient ' +
              'API issue. Try again later.',
          };
          if (lastEmitted !== 'failed') opts.onStatusChange?.(failed);
          return failed;
        }
      } else if (status.status !== 'not_found') {
        consecutiveNotFound = 0;
      }

      const elapsed = Date.now() - start;
      if (elapsed > timeout) {
        throw new ArtifactError(
          `Task ${taskId} timed out after ${timeout}ms (last status: ${status.status})`,
        );
      }
      await sleep(Math.min(interval, timeout - elapsed));
      interval = Math.min(interval * 2, max);
    }
  }

  // ===========================================================================
  // Download
  // ===========================================================================

  async downloadAudio(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
  ): Promise<string> {
    return this.downloadMedia(notebookId, outputPath, artifactId, ArtifactTypeCode.AUDIO, 'audio');
  }

  async downloadVideo(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
  ): Promise<string> {
    return this.downloadMedia(notebookId, outputPath, artifactId, ArtifactTypeCode.VIDEO, 'video');
  }

  async downloadInfographic(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
  ): Promise<string> {
    return this.downloadMedia(
      notebookId,
      outputPath,
      artifactId,
      ArtifactTypeCode.INFOGRAPHIC,
      'infographic',
    );
  }

  async downloadSlideDeck(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
    outputFormat: 'pdf' | 'pptx' = 'pdf',
  ): Promise<string> {
    if (outputFormat !== 'pdf' && outputFormat !== 'pptx') {
      throw new ArtifactError(`Invalid format '${outputFormat}'. Must be 'pdf' or 'pptx'.`);
    }
    const raw = await this.listRaw(notebookId);
    const art = selectArtifact(raw, artifactId, ArtifactTypeCode.SLIDE_DECK, 'slide_deck');
    const metadata = art[16];
    if (!Array.isArray(metadata)) {
      throw new ArtifactParseError('slide deck metadata has unexpected structure');
    }
    const url = outputFormat === 'pptx' ? metadata[4] : metadata[3];
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new ArtifactDownloadError(`Could not find ${outputFormat.toUpperCase()} download URL`);
    }
    return this.session.transport.download(url, outputPath);
  }

  async downloadReport(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
  ): Promise<string> {
    const raw = await this.listRaw(notebookId);
    const art = selectArtifact(raw, artifactId, ArtifactTypeCode.REPORT, 'report');
    const wrapper = art[7];
    const markdown = Array.isArray(wrapper) && wrapper.length > 0 ? wrapper[0] : wrapper;
    if (typeof markdown !== 'string') {
      throw new ArtifactParseError('report content has unexpected structure');
    }
    return writeTextFile(outputPath, markdown);
  }

  async downloadDataTable(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
  ): Promise<string> {
    const raw = await this.listRaw(notebookId);
    const art = selectArtifact(raw, artifactId, ArtifactTypeCode.DATA_TABLE, 'data_table');
    const { headers, rows } = parseDataTable(art[18]);
    return writeTextFile(outputPath, toCsv(headers, rows));
  }

  async downloadQuiz(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
    outputFormat: InteractiveFormat = 'json',
  ): Promise<string> {
    return this.downloadInteractive(notebookId, outputPath, artifactId, outputFormat, true);
  }

  async downloadFlashcards(
    notebookId: string,
    outputPath: string,
    artifactId?: string,
    outputFormat: InteractiveFormat = 'json',
  ): Promise<string> {
    return this.downloadInteractive(notebookId, outputPath, artifactId, outputFormat, false);
  }

  // ===========================================================================
  // Management
  // ===========================================================================

  /** Delete an artifact. Returns true on success. */
  async delete(notebookId: string, artifactId: string): Promise<boolean> {
    void notebookId;
    await this.session.call('DELETE_ARTIFACT', [[2], artifactId], { allowNull: true });
    return true;
  }

  /** Rename an artifact. */
  async rename(notebookId: string, artifactId: string, newTitle: string): Promise<void> {
    void notebookId;
    await this.session.call('RENAME_ARTIFACT', [[artifactId, newTitle], [['title']]], {
      allowNull: true,
    });
  }

  /**
   * Retry a failed Studio artifact in place (the UI "Retry" action). Re-runs
   * generation without deleting it first; the same `artifactId` is preserved as
   * the task id, so `pollStatus`/`waitForCompletion` flows keep working. An
   * accepted retry returns `status: 'in_progress'`.
   *
   * `notebookId` is routing-only (sets the `source-path` header); the artifact
   * is identified solely by `artifactId`. A null result or a row with no
   * artifact id means retry is unavailable/refused and throws (rather than
   * reporting a silent failure). Ported from notebooklm-py `retry_failed`.
   */
  async retryFailed(notebookId: string, artifactId: string): Promise<GenerationStatus> {
    // The in-place retry RPC takes the full Studio client-options envelope as
    // param 0 (per the upstream RETRY_ARTIFACT golden fixture), not the short
    // `[2]` form the other ops use here.
    const clientOptions = [
      2,
      null,
      null,
      [1, null, null, null, null, null, null, null, null, null, [1]],
      [[1, 4, 8, 2, 3, 6]],
    ];
    const result = await this.session.call<unknown>('RETRY_ARTIFACT', [clientOptions, artifactId], {
      allowNull: true,
      sourcePath: `/notebook/${notebookId}`,
    });
    if (result === null || result === undefined) {
      throw new ArtifactError(`Retry unavailable or refused for artifact ${artifactId}.`);
    }
    const status = parseGenerationResult(result);
    if (!status.taskId) {
      throw new ArtifactError(`RETRY_ARTIFACT returned no artifact id for ${artifactId}.`);
    }
    return status;
  }

  /** Export an artifact to Google Docs (1) or Sheets (2). Returns the raw RPC result. */
  async export(
    notebookId: string,
    opts: { artifactId?: string; content?: string; title?: string; exportType?: 1 | 2 } = {},
  ): Promise<unknown> {
    void notebookId;
    const params = [
      null,
      opts.artifactId ?? null,
      opts.content ?? null,
      opts.title ?? 'Export',
      opts.exportType ?? 1,
    ];
    return this.session.call<unknown>('EXPORT_ARTIFACT', params, { allowNull: true });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async callGenerate(notebookId: string, params: unknown[]): Promise<GenerationStatus> {
    void notebookId;
    try {
      const result = await this.session.call<unknown>('CREATE_ARTIFACT', params, {
        allowNull: true,
      });
      return parseGenerationResult(result);
    } catch (err) {
      const failed = generationFailureFromRpcError(err);
      if (failed) return failed;
      throw err;
    }
  }

  private async listRaw(notebookId: string): Promise<unknown[]> {
    const params = [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'];
    const result = await this.session.call<unknown>('LIST_ARTIFACTS', params, { allowNull: true });
    // Common wrap: [[...rows]] where the inner list is the rows array.
    if (
      Array.isArray(result) &&
      result.length === 1 &&
      Array.isArray(result[0]) &&
      (result[0].length === 0 || Array.isArray(result[0][0]))
    ) {
      return result[0];
    }
    return Array.isArray(result) ? result : [];
  }

  private async downloadMedia(
    notebookId: string,
    outputPath: string,
    artifactId: string | undefined,
    typeCode: number,
    typeName: string,
  ): Promise<string> {
    const raw = await this.listRaw(notebookId);
    const art = selectArtifact(raw, artifactId, typeCode, typeName);
    const url = extractArtifactUrl(art, typeCode);
    if (!url) {
      throw new ArtifactParseError(`Could not extract ${typeName} download URL from artifact`);
    }
    return this.session.transport.download(url, outputPath);
  }

  private async downloadInteractive(
    notebookId: string,
    outputPath: string,
    artifactId: string | undefined,
    outputFormat: InteractiveFormat,
    isQuiz: boolean,
  ): Promise<string> {
    const kind: ArtifactType = isQuiz ? 'quiz' : 'flashcards';
    const artifacts = (await this.list(notebookId, kind)).filter(
      (a) => a.status === ArtifactStatus.COMPLETED,
    );
    if (artifacts.length === 0) throw new ArtifactNotReadyError(`No completed ${kind} found`);
    artifacts.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    let artifact: Artifact | undefined;
    if (artifactId) {
      artifact = artifacts.find((a) => a.id === artifactId);
      if (!artifact) throw new ArtifactNotFoundError(`${kind} artifact not found: ${artifactId}`);
    } else {
      artifact = artifacts[0];
    }

    const html = await this.getArtifactContent(notebookId, artifact!.id);
    if (!html) throw new ArtifactDownloadError(`Failed to fetch ${kind} content`);
    const appData = extractAppData(html);
    const title = artifact!.title || (isQuiz ? 'Untitled Quiz' : 'Untitled Flashcards');
    const content = formatInteractiveContent(appData, title, outputFormat, html, isQuiz);
    return writeTextFile(outputPath, content);
  }

  private async getArtifactContent(notebookId: string, artifactId: string): Promise<string | null> {
    void notebookId;
    const result = await this.session.call<unknown>('GET_INTERACTIVE_HTML', [artifactId], {
      allowNull: true,
    });
    if (Array.isArray(result) && result.length > 0) {
      const data = result[0];
      if (Array.isArray(data) && data.length > 9 && Array.isArray(data[9]) && data[9].length > 0) {
        return typeof data[9][0] === 'string' ? data[9][0] : null;
      }
    }
    return null;
  }
}

/** Build `count` nulls for position-padding in generation params. */
function nulls(count: number): null[] {
  return new Array<null>(count).fill(null);
}

/** Parse a CREATE_ARTIFACT/REVISE_SLIDE result into a GenerationStatus. */
function parseGenerationResult(result: unknown): GenerationStatus {
  const first = Array.isArray(result) ? result[0] : undefined;
  const artifactId = Array.isArray(first) ? first[0] : undefined;
  if (typeof artifactId === 'string' && artifactId) {
    const statusCode = Array.isArray(first) && first.length > 4 ? first[4] : null;
    const status = typeof statusCode === 'number' ? artifactStatusToString(statusCode) : 'pending';
    return { taskId: artifactId, status };
  }
  return { taskId: '', status: 'failed', error: 'Generation failed — no artifact_id returned' };
}

/**
 * If `err` is a USER_DISPLAYABLE_ERROR RPCError (rate limit / quota), turn it
 * into a failed GenerationStatus; otherwise return null so the caller rethrows.
 */
function generationFailureFromRpcError(err: unknown): GenerationStatus | null {
  if (err instanceof RPCError && err.rpcCode === 'USER_DISPLAYABLE_ERROR') {
    return {
      taskId: '',
      status: 'failed',
      error: err.message,
      errorCode: String(err.rpcCode),
    };
  }
  return null;
}

/** Whether a media artifact's download URLs are populated (non-media → always ready). */
function isMediaReady(art: unknown[], artifactType: number): boolean {
  if (MEDIA_TYPES.has(artifactType)) {
    return extractArtifactUrl(art, artifactType) !== undefined;
  }
  return true;
}

/** Best-effort human-readable error string from a failed artifact row. */
function extractArtifactError(art: unknown[]): string | undefined {
  if (art.length > 3 && typeof art[3] === 'string' && art[3].trim()) return art[3].trim();
  if (art.length > 5 && Array.isArray(art[5])) {
    for (const item of art[5]) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      if (Array.isArray(item)) {
        for (const sub of item) {
          if (typeof sub === 'string' && sub.trim()) return sub.trim();
        }
      }
    }
  }
  return undefined;
}

/**
 * Pick a COMPLETED artifact of `typeCode` — by explicit id, or the most recent.
 * Throws ArtifactNotReadyError / ArtifactNotFoundError to match py semantics.
 */
function selectArtifact(
  candidates: unknown[],
  artifactId: string | undefined,
  typeCode: number,
  typeName: string,
): unknown[] {
  const filtered = candidates.filter(
    (a): a is unknown[] =>
      Array.isArray(a) && a.length > 4 && a[2] === typeCode && a[4] === ArtifactStatus.COMPLETED,
  );

  if (artifactId) {
    const found = filtered.find((a) => a[0] === artifactId);
    if (!found) throw new ArtifactNotReadyError(`${typeName} artifact not ready: ${artifactId}`);
    return found;
  }
  if (filtered.length === 0) throw new ArtifactNotReadyError(`No completed ${typeName} available`);

  filtered.sort((a, b) => {
    const ta = Array.isArray(a[15]) && a[15].length > 0 ? (a[15][0] as number) || 0 : 0;
    const tb = Array.isArray(b[15]) && b[15].length > 0 ? (b[15][0] as number) || 0 : 0;
    return tb - ta;
  });
  return filtered[0]!;
}

async function writeTextFile(outputPath: string, content: string): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf-8');
  return outputPath;
}
