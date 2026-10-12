import { DEFAULT_USER_ID } from "./constants";

/**
 * TRANSITION ONLY: delete this function (and the deployment's
 * OPENROUTER_API_KEY) once the owner has saved their own provider key.
 *
 * The deployment key serves the owner's library and only while the owner has
 * no saved credential at all. It must never serve any other reader. This is
 * the only place in the backend that reads OPENROUTER_API_KEY.
 */
export function ownerDeploymentKey(
  userId: string,
  savedCredentials: number,
): string | null {
  if (userId !== DEFAULT_USER_ID || savedCredentials > 0) return null;
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

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
