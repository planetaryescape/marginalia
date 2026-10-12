// Reader API keys are sealed with AES-256-GCM under a server-held key. Only
// actions that call a provider decrypt them; nothing returns or logs them.
import { ConvexError } from "convex/values";
import { PROVIDER_NAMES, type Provider } from "./providers";

export const KEY_NOT_CONFIGURED =
  "Saving AI provider keys isn't set up on this server yet.";

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function serverKey(): Promise<CryptoKey> {
  const encoded = process.env.PROVIDER_KEYS_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new ConvexError(KEY_NOT_CONFIGURED);
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64(encoded);
  } catch {
    throw new ConvexError(KEY_NOT_CONFIGURED);
  }
  if (raw.length !== 32) throw new ConvexError(KEY_NOT_CONFIGURED);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// Binds a ciphertext to its reader and provider: a row copied elsewhere fails
function additionalData(userId: string, provider: Provider) {
  return new TextEncoder().encode(
    `marginalia/provider-key/v1\u0000${userId}\u0000${provider}`,
  );
}

export async function encryptProviderKey(
  plaintext: string,
  userId: string,
  provider: Provider,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await serverKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId, provider) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

export async function decryptProviderKey(row: {
  userId: string;
  provider: Provider;
  ciphertext: string;
  iv: string;
}): Promise<string> {
  const key = await serverKey();
  const opened = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(row.iv),
      additionalData: additionalData(row.userId, row.provider),
    },
    key,
    fromBase64(row.ciphertext),
  );
  return new TextDecoder().decode(opened);
}

/** Trimmed key, or a plain-language error that never repeats the key. */
export function cleanProviderKey(input: string): string {
  const key = input.trim();
  if (key.length < 20 || key.length > 512 || /\s/.test(key))
    throw new ConvexError(
      "That doesn't look like a complete API key. Copy it again and paste the whole key.",
    );
  return key;
}

function validationRequest(
  provider: Provider,
  key: string,
): { url: string; headers: Record<string, string> } {
  switch (provider) {
    // OpenRouter's model list is public; the key endpoint checks the key
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/key",
        headers: { Authorization: `Bearer ${key}` },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${key}` },
      };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      };
  }
}

/** Lists the provider's models with the key; throws a reader-facing error if it's refused. */
export async function validateProviderKey(
  provider: Provider,
  key: string,
): Promise<void> {
  const name = PROVIDER_NAMES[provider];
  const { url, headers } = validationRequest(provider, key);
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ConvexError(
      `Couldn't reach ${name} to check the key. Try again.`,
    );
  }
  await response.body?.cancel().catch(() => {});
  if (response.ok) return;
  if (response.status === 401 || response.status === 403)
    throw new ConvexError(
      `${name} didn't accept that key. Check it's active and copied in full.`,
    );
  if (response.status === 429)
    throw new ConvexError(
      `${name} is limiting requests right now. Try again in a minute.`,
    );
  throw new ConvexError(
    `${name} couldn't check the key (error ${response.status}). Try again.`,
  );
}
