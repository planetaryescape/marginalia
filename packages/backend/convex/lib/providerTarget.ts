/** API-key targets remain synchronous; plan credentials are resolved on attempt. */
export interface TargetCredential {
  apiKey: string;
  resolveApiKey?: () => Promise<string>;
}

export async function resolveTarget<T extends TargetCredential>(
  target: T,
): Promise<Omit<T, "apiKey" | "resolveApiKey"> & { apiKey: string }> {
  const { apiKey, resolveApiKey, ...model } = target;
  return { ...model, apiKey: resolveApiKey ? await resolveApiKey() : apiKey };
}
