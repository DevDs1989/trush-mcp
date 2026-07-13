import { z } from "zod";

export const ScanTodosSchema = z.object({
  cwd: z.string().describe("Absolute directory path to scan. MUST be provided."),
});

export const SearchTodosSchema = z.object({
  cwd: z.string().describe("Absolute directory path to scan. MUST be provided."),
  query: z.string().describe("Search query (keywords only, NO conversational filler like 'search for')"),
});

export const GetStreakStatusSchema = z.object({});

export const ResolveTodoSchema = z.object({
  type: z.enum(["TODO", "FIXME", "BUG", "HACK", "XXX"]).describe("The type of comment that was resolved"),
  file: z.string().describe("The file path where the comment was resolved"),
});

export const AggregateDebtSchema = z.object({
  paths: z.array(z.string()).describe("Array of absolute repository paths to aggregate"),
});

export const TopPriorityTodoSchema = z.object({
  count: z.number().optional().default(1).describe("Number of top priority items to return"),
  repo_path: z.string().describe("Absolute directory path to scan. MUST be provided."),
});

export const GetTodoContextSchema = z.object({
  file: z.string().describe("Relative path to the file"),
  line: z.number().describe("Line number of the TODO"),
});
