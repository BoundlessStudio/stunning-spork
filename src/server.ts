import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import type { Response as ExpressResponse, Request } from "express";
import { toolDefinitions } from "./tools-contracts";
import { brandJsonSchema } from "./brandSchema";
import { brandfetch_fetch_impl, cua_browse_impl } from "./tools";

dotenv.config();

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const OPENAI_SYSTEM_INSTRUCTION =
  "Prefer calling brandfetch_fetch first.\n" +
  "Call cua_browse only to verify or fill missing fields, expand menus, or expose footer brand blocks.\n" +
  "Map CSS variables like --primary, --secondary, and meta theme-color to the corresponding output fields.\n" +
  "Use computed body background as backgroundColor and computed body text color as textColor when available.\n" +
  "Deduplicate colors. Normalize to lowercase hex. If ambiguous, leave fields empty and keep colors in palette with role:\"unknown\".";

const app = express();
app.use(express.json({ limit: "1mb" }));
// TODO: Add rate limiting (10 req/min per IP).

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const toolHandlers: Record<string, ToolHandler> = {
  brandfetch_fetch: async (args) =>
    brandfetch_fetch_impl({ url: String(args.url ?? "") }),
  cua_browse: async (args) =>
    cua_browse_impl({
      url: String(args.url ?? ""),
      goal: typeof args.goal === "string" ? args.goal : undefined,
      max_steps: typeof args.max_steps === "number" ? args.max_steps : undefined,
    }),
};

app.post("/brand-scan", async (req: Request, res: ExpressResponse) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  console.info("/brand-scan request", { url });

  if (!url) {
    return res.status(400).json({ error: "Missing url." });
  }

  if (url.length > 2048) {
    return res.status(400).json({ error: "URL is too long." });
  }

  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "URL must start with http or https." });
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("Missing OPENAI_API_KEY environment variable");
    return res.status(500).json({ error: "Server misconfiguration." });
  }

  try {
    const response = await runResponsesLoop(url);
    return res.status(200).json(response);
  } catch (error) {
    console.warn("/brand-scan error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Failed to process brand scan." });
  }
});

app.use((err: Error, _req: Request, res: ExpressResponse, _next: express.NextFunction) => {
  console.warn("Unhandled error", { message: err.message });
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.info(`Server listening on port ${PORT}`);
});

async function runResponsesLoop(url: string): Promise<unknown> {
  const initialResponse = await openai.responses.create({
    model: "gpt-5",
    instructions: OPENAI_SYSTEM_INSTRUCTION,
    input: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({ url }),
          },
        ],
      },
    ],
    tools: toolDefinitions,
    tool_choice: "auto",
    response_format: {
      type: "json_schema",
      json_schema: brandJsonSchema,
    },
  });

  let currentResponse = initialResponse;

  while (true) {
    const toolCalls = extractToolCalls(currentResponse);
    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const handler = toolHandlers[toolCall.name];
        if (!handler) {
          console.warn("Unknown tool requested", { tool: toolCall.name });
          return {
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: "Unknown tool." }),
          };
        }

        let parsedArguments: Record<string, unknown> = {};
        try {
          const rawArguments =
            typeof toolCall.arguments === "string"
              ? toolCall.arguments
              : JSON.stringify(toolCall.arguments ?? {});
          parsedArguments = JSON.parse(rawArguments ?? "{}");
        } catch (error) {
          console.warn("Failed to parse tool arguments", {
            tool: toolCall.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          const toolResult = await handler(parsedArguments);
          return {
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult ?? {}),
          };
        } catch (error) {
          console.warn("Tool execution failed", {
            tool: toolCall.name,
            message: error instanceof Error ? error.message : String(error),
          });
          return {
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: "Tool execution failed." }),
          };
        }
      })
    );

    currentResponse = await openai.responses.submitToolOutputs(currentResponse.id, {
      tool_outputs: toolOutputs,
    });
  }

  const outputText = currentResponse.output_text;
  if (!outputText) {
    throw new Error("No output text returned from model.");
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    console.warn("Failed to parse model output", {
      message: error instanceof Error ? error.message : String(error),
      outputText,
    });
    throw new Error("Invalid model output.");
  }
}

function extractToolCalls(response: OpenAI.Beta.Responses.Response) {
  const calls: {
    id: string;
    name: string;
    arguments?: unknown;
  }[] = [];

  for (const item of response.output ?? []) {
    if (item.type === "tool_call" && item.tool_name) {
      calls.push({
        id: item.id,
        name: item.tool_name,
        arguments: item.input,
      });
    }
  }

  return calls;
}
