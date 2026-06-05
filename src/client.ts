/**
 * Main NotebookLMClient — entry point for all API operations.
 *
 * Mirrors `NotebookLMClient` from `notebooklm-py`:
 *
 * ```ts
 * const client = await NotebookLMClient.fromStorage();
 * const notebooks = await client.notebooks.list();
 * ```
 */

import { ArtifactsAPI } from './api/artifacts.js';
import { ChatAPI } from './api/chat.js';
import { NotebooksAPI } from './api/notebooks.js';
import { SourcesAPI } from './api/sources.js';
import { getStoragePath } from './auth/paths.js';
import { loadStorageState } from './auth/storage.js';
import { configureProxyFromEnv } from './proxy.js';
import { AuthError } from './rpc/errors.js';
import { Session } from './session/session.js';

export interface ClientOptions {
  /** Path to storage_state.json — defaults to `~/.config/notebooklm-node/storage_state.json`. */
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

export class NotebookLMClient {
  readonly session: Session;
  readonly notebooks: NotebooksAPI;
  readonly sources: SourcesAPI;
  readonly chat: ChatAPI;
  readonly artifacts: ArtifactsAPI;
  private readonly readOnlyStorage: boolean;

  private constructor(session: Session, readOnlyStorage: boolean) {
    this.session = session;
    this.readOnlyStorage = readOnlyStorage;
    this.notebooks = new NotebooksAPI(session);
    this.sources = new SourcesAPI(session);
    this.chat = new ChatAPI(session);
    this.artifacts = new ArtifactsAPI(session, this.notebooks);
  }

  /**
   * Open a client from a persisted storage state.
   *
   * @throws {AuthError} when no storage_state.json exists at the resolved path.
   */
  static async fromStorage(opts: ClientOptions = {}): Promise<NotebookLMClient> {
    configureProxyFromEnv();
    const storagePath = opts.storagePath ?? getStoragePath();
    const state = await loadStorageState(storagePath);
    if (!state) {
      throw new AuthError(`No storage_state.json at ${storagePath}. Run 'notebooklm login' first.`);
    }
    const sessionOpts: ConstructorParameters<typeof Session>[0] = { storagePath, state };
    if (opts.disableKeepalive !== undefined) sessionOpts.disableKeepalive = opts.disableKeepalive;
    return new NotebookLMClient(new Session(sessionOpts), opts.readOnlyStorage ?? false);
  }

  /** Persist current cookie state to disk (no-op when `readOnlyStorage`). */
  async save(): Promise<void> {
    if (this.readOnlyStorage) return;
    await this.session.saveStorage();
  }
}
