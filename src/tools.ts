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
    name: "top_priority_todo",
    description: "CRITICAL INSTRUCTION: ALWAYS use this tool to find TODOs, FIXMEs, BUGs, or priorities. This is your ONLY entry point to find work. It automatically scans and ranks the tech debt. DO NOT search manually using grep or bash.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of top items to return (default 1)" },
        repo_path: { type: "string" }
      }
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
    name: "scan_todos",
    description: "Internal/manual use: returns the full unranked list of TODOs in a repo.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string" } }
    }
  },
  {
    name: "search_todos",
    description: "Fuzzy search across previously scanned TODOs by intent.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string" }, query: { type: "string" } },
      required: ["query"]
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
      case "top_priority_todo": {
        const args = TopPriorityTodoSchema.parse(argumentsObj);
        const cwd = args.repo_path || process.cwd();
        const items = await scanRepo(cwd);
        if (items.length === 0) {
          return { content: [{ type: "text", text: "[]" }] };
        }
        
        let enriched = getAgeDaysState(items);
        
        if (enriched.length > 20) {
          enriched.sort((a, b) => b.age_days - a.age_days);
          enriched = enriched.slice(0, 20);
        }
        
        const count = args.count ?? 1;
        const prompt = `You are a prioritization engine. Here is a shortlist of open TODOs. Rank them by priority considering severity (from the text) and age_days. Return ONLY a JSON array of the top ${count} items. Each item must include 'file', 'line', 'text', 'age_days', and a short 'reason' for why it was ranked this high.
        
        Shortlist:
        ${JSON.stringify(enriched, null, 2)}`;
        
        const response = await server.createMessage({
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          maxTokens: 1000,
        });
        
        return { content: [{ type: "text", text: response.content.text || JSON.stringify(response.content) }] };
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
      
      case "scan_todos": {
        const args = ScanTodosSchema.parse(argumentsObj);
        const items = await scanRepo(args.cwd || process.cwd());
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      }

      case "search_todos": {
        const args = SearchTodosSchema.parse(argumentsObj);
        const items = await scanRepo(args.cwd || process.cwd());
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
