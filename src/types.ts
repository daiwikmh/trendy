import { z } from "zod";

export const JobRequestSchema = z.object({
  roles: z.array(z.string()).min(1),
  companies_or_urls: z.array(z.string()).default([]),
  constraints: z
    .object({
      locations: z.array(z.string()).default([]),
      remote: z.boolean().nullable().default(null),
      min_salary: z.string().nullable().default(null),
      other: z.array(z.string()).default([]),
    })
    .default({ locations: [], remote: null, min_salary: null, other: [] }),
  max_applications: z.number().int().positive().default(5),
});

export type JobRequest = z.infer<typeof JobRequestSchema>;

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
