export type OpenAITool = {
  name: string;
  description: string;
};

export function toOpenAITool(name: string, description: string): OpenAITool {
  return { name, description };
}
