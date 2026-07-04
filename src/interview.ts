import { jsonChat } from "./llm.js";
import { GapQuestionsSchema, type GapQuestion } from "./types.js";

const SYSTEM = `You are onboarding a job applicant. Given their resume text, identify information that job application forms always require but the resume does not answer. Output ONLY JSON:
{ "questions": [ { "field": "snake_case_key", "question": "spoken-friendly question" } ] }

Only ask about genuinely missing facts. Candidate fields to consider: work_authorization (for the country they're applying in), notice_period, current_compensation, expected_compensation, willing_to_relocate, phone, email, current_location, earliest_start_date.
Never ask about things the resume already states. Ask at most 6 questions, most important first. Questions must sound natural when read aloud by a voice assistant.`;

export async function findGaps(resumeText: string): Promise<GapQuestion[]> {
  const { questions } = await jsonChat(
    SYSTEM,
    `Resume:\n\n${resumeText}`,
    GapQuestionsSchema
  );
  return questions;
}
