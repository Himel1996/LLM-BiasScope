import { NextRequest, NextResponse } from 'next/server';

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const HF_BASE_URL =
  process.env.HUGGINGFACE_INFERENCE_BASE_URL?.replace(/\/+$/, '') ??
  'https://router.huggingface.co/hf-inference/models';
const DETECTOR_MODEL = 'himel7/bias-detector';
const TYPE_MODEL = 'maximuspowers/bias-type-classifier';

type HfClassification = { label: string; score: number };

const friendlyLabel = (label: string) => {
  if (!label) return 'Unknown';
  const normalized = label.toLowerCase();
  if (normalized === 'label_1' || normalized === 'biased' || normalized === 'bias') {
    return 'Biased';
  }
  if (normalized === 'label_0' || normalized === 'neutral' || normalized === 'unbiased') {
    return 'Unbiased';
  }
  return label
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runClassification(model: string, text: string): Promise<HfClassification | null> {
  if (!HF_TOKEN) {
    throw new Error('Missing HUGGINGFACE_TOKEN environment variable.');
  }

  const url = `${HF_BASE_URL.replace(/\/+$/, '')}/${model}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: text }),
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    const message =
      typeof data === 'object' && data && 'error' in data
        ? (data as { error: string }).error
        : typeof data === 'string' && data.trim().length
          ? data
          : 'Hugging Face inference request failed.';
    throw new Error(message);
  }

  const prediction = Array.isArray(data) ? data[0] : data;
  if (!prediction || typeof prediction !== 'object') return null;
  if (typeof prediction.label !== 'string' || typeof prediction.score !== 'number') return null;

  return prediction as HfClassification;
}

export async function POST(req: NextRequest) {
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Text is required for bias analysis.' }, { status: 400 });
    }
    if (!HF_TOKEN) {
      return NextResponse.json(
        { error: 'HUGGINGFACE_TOKEN is not configured on the server.' },
        { status: 500 }
      );
    }

    const [biasDetection, biasType] = await Promise.all([
      runClassification(DETECTOR_MODEL, text),
      runClassification(TYPE_MODEL, text).catch((error) => {
        console.warn('Bias type classification failed:', error);
        return null;
      }),
    ]);

    if (!biasDetection) {
      return NextResponse.json(
        { error: 'Did not receive a valid response from the bias detector model.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      text,
      detection: {
        label: biasDetection.label,
        friendlyLabel: friendlyLabel(biasDetection.label),
        score: biasDetection.score,
      },
      type: biasType
        ? {
            label: friendlyLabel(biasType.label),
            score: biasType.score,
          }
        : null,
    });
  } catch (error) {
    console.error('Bias analysis error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unexpected error while running bias analysis.',
      },
      { status: 500 }
    );
  }
}
