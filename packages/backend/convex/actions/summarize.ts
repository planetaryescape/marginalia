"use node";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { action } from "../functions";
import { generateObjectWithFallback } from "../lib/aiModels";
import { NO_PROVIDER_MESSAGE } from "../lib/providers";
import { loadReaderAI } from "../lib/router";
import { requireReaderLimit } from "../limits";

const MAX_CHARS = 200_000;
const MAX_IDEAS = 7;
const MAX_LINKS = 14;

const ROLES = [
  "premise",
  "evidence",
  "claim",
  "counterpoint",
  "conclusion",
] as const;
const RELATIONS = ["supports", "leads_to", "contrasts", "illustrates"] as const;

// Limits live in the descriptions and are enforced after generation, so a
// slightly long list trims instead of failing the whole summary.
export const summarySchema = z.object({
  gist: z
    .string()
    .describe(
      "2–3 sentences, under 80 words: the argument in plain words and why it matters.",
    ),
  thesis: z
    .string()
    .describe(
      "The article's main point in one sentence, under 25 words. Always give one: it is the first thing the reader sees.",
    ),
  ideas: z
    .array(
      z.object({
        id: z.string().describe('Short unique id like "a", "b", "c".'),
        label: z
          .string()
          .describe("The idea in 2–6 words, as a phrase a reader could scan."),
        detail: z
          .string()
          .describe(
            "One sentence, under 30 words, saying what the idea is and why it matters here.",
          ),
        role: z
          .enum(ROLES)
          .describe(
            "premise: a starting assumption or setup. evidence: an example, data or anecdote. claim: an intermediate argument. counterpoint: an objection or tension the article raises. conclusion: what it all builds to.",
          ),
        paragraphs: z
          .array(z.number())
          .describe("¶ numbers where the idea appears."),
      }),
    )
    .describe(
      "About 7 ideas at most: the ones that carry the argument, including a conclusion. Fewer is better than padding.",
    ),
  links: z
    .array(
      z.object({
        from: z.string().describe("id of the idea the link starts at."),
        to: z.string().describe("id of the idea it points to."),
        relation: z
          .enum(RELATIONS)
          .describe(
            "supports: from is a reason for to. leads_to: from sets up or causes to. contrasts: from pushes against to. illustrates: from is an example of to.",
          ),
      }),
    )
    .describe(
      "How the ideas connect. Build a tree that leads to the conclusion: most links run along that path. At most 2 links may skip it (a cross-link). Add a link only if it adds understanding; never add one just to connect things.",
    ),
  flow: z
    .string()
    .describe(
      "2–4 sentences on how the argument progresses and where its ideas meet, in plain words.",
    ),
});

type Summary = z.infer<typeof summarySchema>;

export const SYSTEM = `You map the argument of long-form articles for a careful reader who wants to see how a piece thinks before reading it.
The article is given with numbered paragraphs (¶1, ¶2, …). Be faithful to the article: no outside facts, no praise, no filler.
Don't summarise paragraph by paragraph. Find the handful of ideas that carry the argument, then show how they connect and build to the point: which ideas set things up, which support or illustrate others, where the article pushes against itself, and what it all arrives at.
The idea map must stay legible: about seven ideas at most, built mostly as a tree that leads to the conclusion, with few cross-links (two at most beyond that path). Add an idea or a line only when it adds understanding.
Write labels as ideas ("Agents can't learn from mistakes"), not topics ("Agent learning").`;

export const generate = action({
  args: {
    articleId: v.id("articles"),
    title: v.string(),
    // Sent by the reader so ¶ numbers match the paragraphs it renders
    paragraphs: v.array(v.string()),
    // Supplied proofs are strict. Legacy callers instead bind their literal
    // display to the server-entry source snapshot, not a reconstructed DOM.
    sourceHash: v.optional(v.string()),
    expectedSummaryId: v.optional(v.id("summaries")),
  },
  handler: async (ctx, args) => {
    const total = args.paragraphs.length;
    if (total === 0) throw new Error("Nothing to summarise");
    await requireReaderLimit(ctx, ctx.readerId, "ai");

    const claim = await ctx.runMutation(internal.summaries.claimFull, {
      ...args,
      userId: ctx.readerId,
    });
    if (claim.kind === "complete") return;
    if (claim.kind === "join") {
      // A timeout does not release the claim or dispatch another paid action.
      for (let read = 0; read < 30; read++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await ctx.runQuery(internal.summaries.fullStatus, {
          userId: ctx.readerId,
          articleId: args.articleId,
          run: claim.run,
        });
        if (status === "complete") return;
        if (status !== "running")
          throw new Error(`Summary ${status}. Try again explicitly.`);
      }
      throw new Error(
        "Summary is still running. Try again to check it; this does not restart it.",
      );
    }

    try {
      let used = 0;
      const lines: string[] = [];
      for (const [i, text] of args.paragraphs.entries()) {
        if (used + text.length > MAX_CHARS) break;
        lines.push(`¶${i + 1}\n${text}`);
        used += text.length;
      }

      const ai = await loadReaderAI(ctx, ctx.readerId);
      const targets = ai.chain("annotations");
      if (!targets.length) throw new ConvexError(NO_PROVIDER_MESSAGE);
      const { object, modelId } = await generateObjectWithFallback<Summary>({
        schema: summarySchema,
        system: SYSTEM,
        prompt: `# ${args.title}\n\n${lines.join("\n\n")}`,
        targets,
        maxOutputTokens: 4096,
        onFailure: ai.noteFailure,
      });

      const clamp = (n: number) => Math.min(Math.max(1, Math.round(n)), total);
      const seen = new Set<string>();
      const ideas = object.ideas
        .filter((idea) => idea.id && !seen.has(idea.id) && seen.add(idea.id))
        .slice(0, MAX_IDEAS)
        .map((idea) => ({
          id: idea.id,
          label: idea.label.trim(),
          detail: idea.detail.trim(),
          role: idea.role,
          paragraphs: [...new Set(idea.paragraphs.map(clamp))]
            .sort((a, b) => a - b)
            .slice(0, 4),
        }));
      const ids = new Set(ideas.map((i) => i.id));
      const linkKeys = new Set<string>();
      const links = object.links
        .filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
        .filter((l) => {
          const key = `${l.from}>${l.to}`;
          if (linkKeys.has(key)) return false;
          linkKeys.add(key);
          return true;
        })
        .slice(0, MAX_LINKS);

      const saved = await ctx.runMutation(internal.summaries.save, {
        userId: ctx.readerId,
        articleId: args.articleId,
        gist: object.gist.trim(),
        thesis: object.thesis.trim(),
        ideas,
        links,
        flow: object.flow.trim(),
        model: modelId,
        generation: { run: claim.run },
      });
      if (!saved)
        throw new Error(
          "Article changed while summarising. Reload and try again.",
        );
    } catch (error) {
      await ctx.runMutation(internal.summaries.failFull, {
        userId: ctx.readerId,
        articleId: args.articleId,
        run: claim.run,
      });
      throw error;
    }
  },
});
