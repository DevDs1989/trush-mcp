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
    description: "CRITICAL INSTRUCTION: ALWAYS use this tool to find TODOs, FIXMEs, BUGs, or priorities. It scans the repo for all tech debt comments, ranks them by age, and presents the user with an interactive plan to approve or deny. Do NOT list the plan items in chat — the tool handles presentation. After the user approves, work on the returned items.",
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
        
        // Build a rich plan artifact for elicitation
        const divider = "─".repeat(50);
        const planLines = topItems.map((item, idx) =>
          `  ${idx + 1}. [${item.type}] ${item.file}:${item.line}\n     "${item.text}"\n     Age: ${item.age_days} day(s)`
        ).join("\n\n");

        const planMessage = [
          `📋 Tech Debt Cleanup Plan`,
          divider,
          `Found ${enriched.length} item(s) total. Showing top ${topItems.length} by age:\n`,
          planLines,
          `\n${divider}`,
          `Review the plan above and approve, deny, or customize.`
        ].join("\n");

        // Build oneOf options for item selection
        const itemChoices = topItems.map((item, idx) => ({
          const: String(idx + 1),
          title: `#${idx + 1} [${item.type}] ${path.basename(item.file)}:${item.line} — "${item.text.length > 50 ? item.text.slice(0, 50) + '…' : item.text}"`
        }));

        try {
          const result = await server.elicitInput({
            mode: "form",
            message: planMessage,
            requestedSchema: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  title: "What would you like to do?",
                  oneOf: [
                    { const: "approve_all", title: "✅ Approve — tackle all items in order" },
                    { const: "pick", title: "🎯 Pick — choose specific item(s)" },
                    { const: "deny", title: "❌ Deny — skip this plan" }
                  ],
                  default: "approve_all"
                },
                selected_items: {
                  type: "string",
                  title: "If picking, which item?",
                  description: "Only used when 'Pick' is selected above",
                  oneOf: itemChoices
                },
                custom_instruction: {
                  type: "string",
                  title: "Custom instruction (optional)",
                  description: "e.g. 'focus on BUGs only' or 'skip item 2, do the rest'"
                }
              },
              required: ["action"]
            }
          });

          if (result.action === "accept" && result.content) {
            const userAction = result.content.action as string;
            const customInstruction = result.content.custom_instruction as string | undefined;
            const selectedItem = result.content.selected_items as string | undefined;

            if (userAction === "deny") {
              return {
                content: [{ type: "text", text: "User denied the plan. No action needed." }]
              };
            }

            if (customInstruction && customInstruction.trim().length > 0) {
              return {
                content: [{
                  type: "text",
                  text: `User approved the plan with custom instruction: "${customInstruction.trim()}"\n\nPlan items:\n${JSON.stringify(topItems, null, 2)}`
                }]
              };
            }

            if (userAction === "pick" && selectedItem) {
              const idx = parseInt(selectedItem, 10) - 1;
              const chosen = topItems[idx] || topItems[0];
              return {
                content: [{
                  type: "text",
                  text: `User approved item #${idx + 1} from the plan. Proceed with:\n${JSON.stringify(chosen, null, 2)}`
                }]
              };
            }

            // approve_all
            return {
              content: [{
                type: "text",
                text: `User approved the full plan. Proceed with all ${topItems.length} item(s) in priority order:\n${JSON.stringify(topItems, null, 2)}`
              }]
            };
          } else if (result.action === "decline") {
            return {
              content: [{ type: "text", text: "User declined the plan. No action needed." }]
            };
          } else {
            return {
              content: [{ type: "text", text: "Plan review was cancelled." }]
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
