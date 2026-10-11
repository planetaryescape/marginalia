"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { embedText } from "../lib/aiModels";

export const embed = internalAction({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.runQuery(internal.userNotes.getByIdInternal, {
      noteId: args.noteId,
    });
    if (!note || !note.contentPlain) return;

    try {
      // Embed the passage, what the note responds to, and the note itself:
      // a reflection like "I think it's both" means nothing without its question
      const textToEmbed = [note.selectedText, note.prompt, note.contentPlain]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8000);
      const embedding = await embedText(textToEmbed);
      await ctx.runMutation(internal.userNotes.setEmbedding, {
        noteId: args.noteId,
        embedding,
      });
    } catch (error) {
      console.error(`Failed to embed user note ${args.noteId}:`, error);
    }
  },
});
