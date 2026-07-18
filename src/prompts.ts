import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const promptDefinitions = [
  {
    name: "daily_cleanup",
    description: "Automates the keep-the-streak-alive loop using the V2 efficient workflow.",
    arguments: [
      {
        name: "count",
        description: "Number of TODOs to batch clean up",
        required: false,
      }
    ]
  },
  {
    name: "pre_refactor_audit",
    description: "Scans a module before refactoring.",
    arguments: [
      {
        name: "module_path",
        description: "Path to the module or directory",
        required: true,
      }
    ]
  }
];

export async function handlePromptCall(name: string, argumentsObj?: any) {
  switch (name) {
    case "daily_cleanup": {
      const count = argumentsObj?.count || 1;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Let's keep my t-rush streak alive by tackling some tech debt today!

1. Use the \`find_todos\` tool with count=${count} to scan this repository — it will present me with an interactive plan to approve or deny via the MCP server. Do NOT list the TODOs in chat.
2. Once I approve the plan via the tool, create a markdown artifact (e.g., 'approved_todos_plan.md') listing the approved items so we have a record before starting the work.
3. Finally, do not implement the fixes yourself. Instead, spawn a subagent (using \`invoke_subagent\`) for each approved TODO to implement the fix. Instruct each subagent to grab the code context, implement the fix, and then mark it as resolved using the \`resolve_todo\` tool so my streak updates.`
            }
          }
        ]
      };
    }
    
    case "pre_refactor_audit": {
      const modulePath = argumentsObj?.module_path || ".";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `I'm preparing to refactor the code inside \`${modulePath}\`. Before I start, could you scan that specific area for any hidden landmines (like open BUGs, FIXMEs, or TODOs)? Please give me a summary of what you find so I know what to watch out for.`
            }
          }
        ]
      };
    }
    
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${name}`);
  }
}
