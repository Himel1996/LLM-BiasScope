import { streamText, UIMessage, convertToModelMessages } from 'ai';

export const maxDuration = 60; // allow streaming up to 60 seconds

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const model = searchParams.get('model') ?? 'openai/gpt-5';
  const temperature = Number(searchParams.get('temp') ?? '0.7');
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model, // routed through Vercel AI Gateway automatically
    messages: convertToModelMessages(messages),
    temperature,
  });

  return result.toTextStreamResponse();
}
