const MODEL_NAMES: Record<string, string> = {
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "openai/gpt-6-luna": "GPT-6 Luna",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
};

/** "google/gemini-3.8-flash" → "Gemini 3.8 Flash" */
export function modelName(id: string): string {
  return (
    MODEL_NAMES[id] ??
    (id.split("/").pop() ?? id)
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}
