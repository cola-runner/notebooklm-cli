/**
 * Main GeminiNotebookClient — entry point for all API operations.
 *
 * Mirrors the main client from `notebooklm-py`:
 *
 * ```ts
 * const client = await GeminiNotebookClient.fromStorage();
 * const notebooks = await client.notebooks.list();
 * ```
 */

import { ArtifactsAPI } from './api/artifacts.js';
import { ChatAPI } from './api/chat.js';
import { LabelsAPI } from './api/labels.js';
import { NotebooksAPI } from './api/notebooks.js';
import { NotesAPI } from './api/notes.js';
import { ResearchAPI } from './api/research.js';
import { ShareAPI } from './api/share.js';
import { SourcesAPI } from './api/sources.js';
import { UserAPI } from './api/user.js';
import { getStoragePath } from './auth/paths.js';
import { loadStorageState } from './auth/storage.js';
import type { StorageState } from './auth/types.js';
import { configureProxyFromEnv } from './proxy.js';
import { AuthError } from './rpc/errors.js';
import { Session } from './session/session.js';

export interface ClientOptions {
  /** Path to storage_state.json — defaults to `~/.config/gemini-notebook-cli/storage_state.json`. */
  storagePath?: string;
  /** Disable the keepalive RotateCookies poke. */
  disableKeepalive?: boolean;
  /**
   * Treat storage as read-only: `save()` becomes a no-op. Use for short-lived,
   * cookie-imported sessions (e.g. the CLI) where persisting Set-Cookie
   * mutations back to disk would risk corrupting the imported session.
   */
  readOnlyStorage?: boolean;
}

export class GeminiNotebookClient {
  readonly session: Session;
  readonly notebooks: NotebooksAPI;
  readonly sources: SourcesAPI;
  readonly labels: LabelsAPI;
  readonly chat: ChatAPI;
  readonly artifacts: ArtifactsAPI;
  readonly notes: NotesAPI;
  readonly share: ShareAPI;
  readonly research: ResearchAPI;
  readonly user: UserAPI;
  private readonly readOnlyStorage: boolean;

  private constructor(session: Session, readOnlyStorage: boolean) {
    this.session = session;
    this.readOnlyStorage = readOnlyStorage;
    this.notebooks = new NotebooksAPI(session);
    this.sources = new SourcesAPI(session);
    this.labels = new LabelsAPI(session);
    this.chat = new ChatAPI(session);
    this.artifacts = new ArtifactsAPI(session, this.notebooks);
    this.notes = new NotesAPI(session);
    this.share = new ShareAPI(session);
    this.research = new ResearchAPI(session);
    this.user = new UserAPI(session);
  }

  /**
   * Open a client from a persisted storage state.
   *
   * @throws {AuthError} when no storage_state.json exists at the resolved path.
   */
  static async fromStorage(opts: ClientOptions = {}): Promise<GeminiNotebookClient> {
    configureProxyFromEnv();
    const storagePath = opts.storagePath ?? getStoragePath();
    const state = await loadStorageState(storagePath);
    if (!state) {
      throw new AuthError(
        `No storage_state.json at ${storagePath}. Run 'gemini-notebook login' first.`,
      );
    }
    const sessionOpts: ConstructorParameters<typeof Session>[0] = { storagePath, state };
    if (opts.disableKeepalive !== undefined) sessionOpts.disableKeepalive = opts.disableKeepalive;
    return new GeminiNotebookClient(new Session(sessionOpts), opts.readOnlyStorage ?? false);
  }

  /**
   * Open a client from an in-memory storage state (cookies not yet persisted).
   *
   * Used by the login flow to verify freshly-pasted cookies against the live
   * API before writing them to disk. Defaults to read-only so the probe never
   * mutates the candidate cookie set.
   */
  static fromState(state: StorageState, opts: ClientOptions = {}): GeminiNotebookClient {
    configureProxyFromEnv();
    const storagePath = opts.storagePath ?? getStoragePath();
    const sessionOpts: ConstructorParameters<typeof Session>[0] = { storagePath, state };
    if (opts.disableKeepalive !== undefined) sessionOpts.disableKeepalive = opts.disableKeepalive;
    return new GeminiNotebookClient(new Session(sessionOpts), opts.readOnlyStorage ?? true);
  }

  /** Persist current cookie state to disk (no-op when `readOnlyStorage`). */
  async save(): Promise<void> {
    if (this.readOnlyStorage) return;
    await this.session.saveStorage();
  }
}
