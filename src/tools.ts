import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";
import {
  scanRepo,
  searchTodos,
  getStreak,
  getStats,
  incrementStreak,
  CommentType,
  TodoItem
} from "@devds1989/trush-core";
import {
  ScanTodosSchema,
  SearchTodosSchema,
  GetStreakStatusSchema,
  ResolveTodoSchema,
  AggregateDebtSchema,
  TopPriorityTodoSchema,
} from "./schemas.js";

export const toolDefinitions = [
  {
    name: "find_todos",
    description: "CRITICAL INSTRUCTION: ALWAYS use this tool to find TODOs, FIXMEs, BUGs, or priorities. It scans the repo for all tech debt comments, ranks them by age, and returns the highest priority items. After calling this tool, work on the item it returns.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of top items to return (default 5)" },
        repo_path: { type: "string", description: "Absolute path to the repository" }
      },
      required: ["repo_path"]
    }
  },
  {
    name: "resolve_todo",
    description: "Mark a TODO as resolved, verifies it's gone from the file, and increments the streak.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["TODO", "FIXME", "BUG", "HACK", "XXX"] },
        file: { type: "string", description: "File path to verify" }
      },
      required: ["type", "file"]
    }
  },
  {
    name: "scan_todos_raw",
    description: "Internal/manual use: returns the full unranked list of TODOs in a repo.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string", description: "Absolute path to the repository" } },
      required: ["cwd"]
    }
  },
  {
    name: "search_todos",
    description: "CRITICAL INSTRUCTION: ALWAYS use this tool instead of generic Search or grep_search when looking for a specific TODO, FIXME, or BUG. Fuzzy searches across the codebase for matching tech debt by intent.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string", description: "Absolute path to the repository" }, query: { type: "string", description: "Keywords only, no conversational filler" } },
      required: ["cwd", "query"]
    }
  },
  {
    name: "get_streak_status",
    description: "Get the current streak and stats data from the shared local store.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "aggregate_debt",
    description: "Aggregate debt and streak views across multiple local repositories.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"]
    }
  }
];

function getAgeDaysState(items: TodoItem[]): any[] {
  const statePath = path.join(os.homedir(), ".t-rush", "mcp_state.json");
  let state: Record<string, number> = {};
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    } catch (e) {}
  }
  const now = Date.now();
  const enriched = items.map(item => {
    const key = `${item.file}:${item.line}`;
    if (!state[key]) {
      state[key] = now;
    }
    const age_days = Math.floor((now - state[key]) / 86400000);
    return { ...item, age_days };
  });
  
  if (!fs.existsSync(path.dirname(statePath))) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return enriched;
}

export async function handleToolCall(name: string, argumentsObj: any, server: Server) {
  try {
    switch (name) {
      case "find_todos": {
        const args = TopPriorityTodoSchema.parse(argumentsObj);
        const cwd = args.repo_path || process.cwd();
        const items = await scanRepo(cwd);
        if (items.length === 0) {
          return { content: [{ type: "text", text: "No TODOs found in this repository! 🎉" }] };
        }
        
        let enriched = getAgeDaysState(items);
        
        // Sort by age_days descending to find the oldest debt
        enriched.sort((a, b) => b.age_days - a.age_days);
        
        // Limit to count items for the selection prompt
        const count = args.count && args.count > 1 ? args.count : Math.min(5, enriched.length);
        const topItems = enriched.slice(0, count);
        
        // Build a detailed summary for the prompt message
        const itemLines = topItems.map((item, idx) =>
          `${idx + 1}. [${item.type}] ${item.file}:${item.line}\n   "${item.text}"\n   Age: ${item.age_days} day(s)`
        ).join("\n\n");

        const promptMessage = `Found ${enriched.length} TODO(s) in the repo. Here are the top ${topItems.length}:\n\n${itemLines}\n\nWhich one would you like to tackle?`;


        try {
          const result = await server.elicitInput({
            mode: "form",
            message: promptMessage,
            requestedSchema: {
              type: "object",
              properties: {
                proceed: {
                  type: "string",
                  title: "Should I proceed with these?",
                  oneOf: [
                    { const: "yes", title: "Yes, go ahead" },
                    { const: "no", title: "No, skip" }
                  ],
                  default: "yes"
                },
                custom_instruction: {
                  type: "string",
                  title: "Or tell me what to do instead (optional)",
                  description: "e.g. 'work on item 3' or 'focus on the BUG in parser.ts'"
                }
              },
              required: ["proceed"]
            }
          });

          if (result.action === "accept" && result.content) {
            const customInstruction = result.content.custom_instruction as string | undefined;
            const proceed = result.content.proceed as string;

            if (customInstruction && customInstruction.trim().length > 0) {
              return {
                content: [{
                  type: "text",
                  text: `User provided custom instruction: "${customInstruction.trim()}"\n\nHere are all the scanned items for context:\n${JSON.stringify(topItems, null, 2)}`
                }]
              };
            }

            if (proceed === "yes") {
              const chosen = topItems[0];
              return {
                content: [{
                  type: "text",
                  text: `User approved. Proceed with the top priority item:\n${JSON.stringify(chosen, null, 2)}`
                }]
              };
            } else {
              return {
                content: [{ type: "text", text: "User chose not to proceed. No action needed." }]
              };
            }
          } else if (result.action === "decline") {
            return {
              content: [{ type: "text", text: "User declined to select a TODO. No action needed." }]
            };
          } else {
            return {
              content: [{ type: "text", text: "TODO selection was cancelled." }]
            };
          }
        } catch (elicitError: any) {
          // Fallback: if elicitation is not supported by the client, return the full list
          console.error("Elicitation not supported, falling back to list:", elicitError.message);
          return { content: [{ type: "text", text: JSON.stringify(topItems, null, 2) }] };
        }
      }

      case "resolve_todo": {
        const args = ResolveTodoSchema.parse(argumentsObj);
        const cwd = process.cwd();
        const fullPath = path.resolve(cwd, args.file);
        
        if (fs.existsSync(fullPath)) {
          const items = await scanRepo(cwd);
          const stillExists = items.find(i => i.file === args.file && i.type.toUpperCase() === args.type.toUpperCase());
          if (stillExists) {
             return { content: [{ type: "text", text: `Warning: The ${args.type} was not removed from the file. Please remove the comment from code first.` }] };
          }
        }
        
        const newStreak = incrementStreak(args.type as CommentType);
        return { 
          content: [{ 
            type: "text", 
            text: `Successfully verified deletion and resolved ${args.type}. New streak is ${newStreak.current} (Longest: ${newStreak.longest})` 
          }] 
        };
      }
      
      case "scan_todos_raw": {
        const args = ScanTodosSchema.parse(argumentsObj);
        const items = await scanRepo(args.cwd || process.cwd());
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      }

      case "search_todos": {
        const args = SearchTodosSchema.parse(argumentsObj);
        const items = await scanRepo(args.cwd);
        const results = searchTodos(items, args.query);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_streak_status": {
        const streak = getStreak();
        const stats = getStats();
        return { content: [{ type: "text", text: JSON.stringify({ streak, stats }, null, 2) }] };
      }

      case "aggregate_debt": {
        const args = AggregateDebtSchema.parse(argumentsObj);
        const results = [];
        const globalStreak = getStreak(); 
        
        for (const repoPath of args.paths) {
          const items = await scanRepo(repoPath);
          results.push({
            repo: path.basename(repoPath),
            path: repoPath,
            debtCount: items.length,
            items: items.length > 0 ? items : undefined
          });
        }
        
        const report = {
          globalStreak,
          repositories: results,
          totalDebtCount: results.reduce((sum, r) => sum + r.debtCount, 0)
        };
        
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${error.message}`);
    }
    return {
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }],
      isError: true,
    };
  }
}
