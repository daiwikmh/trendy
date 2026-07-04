import { z } from "zod";

export const GapQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        field: z.string(),
        question: z.string(),
      })
    )
    .max(8),
});

export type GapQuestion = z.infer<typeof GapQuestionsSchema>["questions"][number];

export interface QAEntry {
  field: string;
  question: string;
  answer: string;
  source: "interview";
  answered_at: string;
}
