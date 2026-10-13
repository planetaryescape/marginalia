import { DEFAULT_USER_ID } from "./constants";

/**
 * TRANSITION ONLY: delete this function (and the deployment's
 * READWISE_TOKEN) once the owner has connected Readwise from their account.
 *
 * The deployment token serves the owner's library and only while the owner
 * has no saved Readwise token. It must never serve any other reader. This is
 * the only place in the backend that reads READWISE_TOKEN.
 */
export function ownerDeploymentReadwiseToken(
  userId: string,
  hasSavedToken: boolean,
): string | null {
  if (userId !== DEFAULT_USER_ID || hasSavedToken) return null;
  return process.env.READWISE_TOKEN?.trim() || null;
}
