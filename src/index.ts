/**
 * Public package entry — re-exports the client, types, and error classes.
 */

export { NotebookLMClient, type ClientOptions } from './client.js';
export { NotebooksAPI } from './api/notebooks.js';
export { LabelsAPI } from './api/labels.js';
export { UserAPI } from './api/user.js';
export type { Label, Notebook, PromptSuggestion, UserAccount } from './types.js';
export {
  AuthError,
  ClientError,
  NetworkError,
  RPCError,
  RPCTimeoutError,
  RateLimitError,
  ServerError,
  UnknownRPCMethodError,
} from './rpc/errors.js';
export { RPCMethod, type RPCMethodName, type RPCMethodId } from './rpc/types.js';
