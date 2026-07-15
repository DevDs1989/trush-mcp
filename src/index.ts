#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions, handleToolCall } from "./tools.js";
import { promptDefinitions, handlePromptCall } from "./prompts.js";

const server = new Server(
  {
    name: "@devds1989/t-rush-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
      elicitation: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolDefinitions };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Pass the server instance down so handleToolCall can execute sampling requests
  return await handleToolCall(request.params.name, request.params.arguments, server);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts: promptDefinitions };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  return await handlePromptCall(request.params.name, request.params.arguments);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("t-rush-mcp server running on stdio");
}

run().catch(console.error);
