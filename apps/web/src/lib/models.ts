const MODEL_NAMES: Record<string, string> = {
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "openai/gpt-6-luna": "GPT-6 Luna",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
};

/** "openrouter:google/gemini-3.8-flash" or "google/gemini-3.8-flash" → "Gemini 3.8 Flash" */
export function modelName(id: string): string {
  const bare = id.replace(/^(openrouter|openai|anthropic):/, "");
  return (
    MODEL_NAMES[bare] ??
    (bare.split("/").pop() ?? bare)
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}
