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
              text: `Let's keep my t-rush streak alive by tackling some tech debt today! Use the find_todos tool with count=${count} to scan this repository — it will present me with an interactive plan to approve or deny.\n\nDo NOT list the TODOs in chat. The tool will handle presenting the plan for my review.\n\nOnce I approve the plan, for each approved item: grab its specific code context, implement the fix, and then mark it as resolved so my streak updates. Please tackle them strictly one by one, finishing the first completely before moving on to the next.`
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
