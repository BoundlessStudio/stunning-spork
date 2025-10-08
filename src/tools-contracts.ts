export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    name: "cua_browse",
    description:
      "Encapsulate a full computer-using agent loop to inspect a web page, gather screenshots, and extract brand artifacts.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        goal: { type: "string" },
        max_steps: { type: "integer", minimum: 1, maximum: 20 }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "brandfetch_fetch",
    description: "Fetch Brandfetch v2 data for the provided URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" }
      },
      required: ["url"],
      additionalProperties: false
    }
  }
];
