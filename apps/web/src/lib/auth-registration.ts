export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_LENGTH_HINT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

export interface RegistrationIssue {
  readonly field: "email" | "password" | null;
  readonly message: string;
}

export function registrationPasswordIssue(
  password: string,
): RegistrationIssue | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? { field: "password", message: PASSWORD_LENGTH_HINT }
    : null;
}

export function registrationFailure(
  error: { readonly code?: string; readonly status?: number },
  mode: "invite" | "owner",
): RegistrationIssue {
  if (error.status === 429 || error.code === "TOO_MANY_REQUESTS")
    return {
      field: null,
      message: "Too many attempts. Wait a minute and try again.",
    };
  if (error.code === "PASSWORD_TOO_SHORT")
    return { field: "password", message: PASSWORD_LENGTH_HINT };
  if (error.code === "PASSWORD_TOO_LONG")
    return {
      field: "password",
      message:
        "This password is too long. Choose a shorter password and try again.",
    };
  if (error.code === "INVALID_EMAIL")
    return { field: "email", message: "Enter a valid email address." };
  if (error.code === "FORBIDDEN" || error.status === 403)
    return {
      field: null,
      message:
        mode === "invite"
          ? "This invitation can't be used. Check that you're using the invited email, or ask the owner for a new link."
          : "This setup link has expired or can't be used. Run bun run setup:owner on the deployment machine for a fresh link, or sign in if you already created your account.",
    };
  return {
    field: null,
    message:
      mode === "invite"
        ? "Couldn't create your account. Try again, or ask the owner for a new invitation."
        : "Couldn't create your owner account. Try again, or run bun run setup:owner for a fresh setup link.",
  };
}
