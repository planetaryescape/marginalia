import { z } from "zod";

const chunkSchema = z.object({
  userId: z.string(),
  filePath: z.string().min(1),
  fileName: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  embedding: z.array(z.number().finite()).length(1536),
  fileHash: z.string().min(1),
  indexedAt: z.number().finite(),
});

export const vaultUploadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), filePath: z.string().min(1) }),
  z.object({
    action: z.literal("upload"),
    chunks: z.array(chunkSchema).min(1).max(25),
  }),
  z.object({
    action: z.literal("replace"),
    filePath: z.string().min(1),
    chunks: z.array(chunkSchema).min(1).max(128),
  }),
]);
