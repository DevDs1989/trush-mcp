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
    description: "CRITICAL INSTRUCTION: ALWAYS use this tool to find TODOs, FIXMEs, BUGs, or priorities. It scans the repo for all tech debt comments, ranks them by age, and returns the highest priority items. After calling this tool, DO NOT list the items in chat. Instead, create a single markdown artifact (e.g. 'todo_plans.md') containing a detailed plan for all of the TODOs. Request user feedback (approval) on this artifact via the RequestFeedback flag before proceeding with the work.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of top items to return (default 5)" },
        repo_path: { type: "string", description: "Absolute path to the repository" },
        directory_filter: { type: "string", description: "Optional subdirectory path to restrict the scan to a specific folder" }
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
      properties: { 
        cwd: { type: "string", description: "Absolute path to the repository" },
        directory_filter: { type: "string", description: "Optional subdirectory path" }
      },
      required: ["cwd"]
    }
  },
  {
    name: "search_todos",
    description: "CRITICAL INSTRUCTION: ALWAYS use this tool instead of generic Search or grep_search when looking for a specific TODO, FIXME, or BUG. Fuzzy searches across the codebase for matching tech debt by intent.",
    inputSchema: {
      type: "object",
      properties: { 
        cwd: { type: "string", description: "Absolute path to the repository" }, 
        query: { type: "string", description: "Keywords only, no conversational filler" },
        directory_filter: { type: "string", description: "Optional subdirectory path" }
      },
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



export async function handleToolCall(name: string, argumentsObj: any, server: Server) {
  try {
    switch (name) {
      case "find_todos": {
        const args = TopPriorityTodoSchema.parse(argumentsObj);
        const baseCwd = args.repo_path || process.cwd();
        const cwd = args.directory_filter ? path.resolve(baseCwd, args.directory_filter) : baseCwd;
        const items = await scanRepo(cwd);
        if (items.length === 0) {
          return { content: [{ type: "text", text: "No TODOs found in this repository! 🎉" }] };
        }
        
        // Calculate priority for each item
        const prioritized = items.map(item => {
          // 1. Severity Score
          let severityScore = 0;
          switch (item.type.toUpperCase()) {
            case "BUG": severityScore = 100; break;
            case "FIXME": severityScore = 50; break;
            case "TODO": severityScore = 0; break;
          }
          
          // 2. Age Bonus
          const ageBonus = item.age_days || 0;
          
          // 3. Context/Objective Bonus
          let contextBonus = 0;
          if (args.objective) {
            const objectiveWords = args.objective.toLowerCase().split(/\s+/);
            const itemText = (item.text + " " + item.file).toLowerCase();
            
            for (const word of objectiveWords) {
              if (word.length > 2 && itemText.includes(word)) {
                contextBonus += 30;
              }
            }
          }
          
          return {
            ...item,
            priority_score: severityScore + ageBonus + contextBonus
          };
        });
        
        // Sort by priority_score descending
        prioritized.sort((a, b) => b.priority_score - a.priority_score);
        
        // Limit to count items for the selection prompt
        const count = args.count && args.count > 1 ? args.count : Math.min(5, prioritized.length);
        const topItems = prioritized.slice(0, count);
        
        return { content: [{ type: "text", text: JSON.stringify(topItems, null, 2) }] };
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
        const baseCwd = args.cwd || process.cwd();
        const cwd = args.directory_filter ? path.resolve(baseCwd, args.directory_filter) : baseCwd;
        const items = await scanRepo(cwd);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      }

      case "search_todos": {
        const args = SearchTodosSchema.parse(argumentsObj);
        const baseCwd = args.cwd || process.cwd();
        const cwd = args.directory_filter ? path.resolve(baseCwd, args.directory_filter) : baseCwd;
        const items = await scanRepo(cwd);
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
