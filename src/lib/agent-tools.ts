import { z } from 'zod';
import { dateSchema } from './domain/validation';

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
}
interface ModelContext {
  registerTool(tool: Tool, options: { signal: AbortSignal }): void | Promise<void>;
}

/** Progressive enhancement: the normal interface works without WebMCP. */
export function registerPlannerTools(actions: {
  read: () => unknown;
  selectDate: (date: string) => Promise<unknown>;
}): () => void {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools: Tool[] = [
    {
      name: 'read_evening',
      description:
        'Read the selected city, its local time zone, the evening date, official event times, and UV forecast currently shown in Gloam.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        z.object({}).strict().parse(input);
        return actions.read();
      },
    },
    {
      name: 'select_evening_date',
      description:
        'Change the visible evening date for the currently selected city and load its official event times. Dates use the city’s local time zone and must be between today and one year ahead.',
      inputSchema: {
        type: 'object',
        properties: { date: { type: 'string', format: 'date' } },
        required: ['date'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const { date } = z.object({ date: dateSchema }).strict().parse(input);
        return actions.selectDate(date);
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(
        () => {},
      );
    } catch {
      /* Unsupported draft implementations must not break the planner. */
    }
  }
  return () => lifecycle.abort();
}
