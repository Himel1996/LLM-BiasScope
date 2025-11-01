import { NextRequest, NextResponse } from 'next/server';

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const HF_BASE_URL =
  process.env.HUGGINGFACE_INFERENCE_BASE_URL?.replace(/\/+$/, '') ??
  'https://api-inference.huggingface.co/models';
const DETECTOR_MODEL = 'himel7/bias-detector';
const TYPE_MODEL = 'maximuspowers/bias-type-classifier';

type HfClassification = { label: string; score: number };

type SentenceAnalysis = {
  sentence: string;
  biasDetection: {
    label: string;
    friendlyLabel: string;
    score: number;
  };
  biasType: {
    label: string;
    score: number;
  } | null;
};

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

// Split text into sentences
function splitIntoSentences(text: string): string[] {
  // Clean up the text
  const cleaned = text.trim().replace(/\s+/g, ' ');
  
  // Split by sentence-ending punctuation followed by whitespace or newline
  // Handle common abbreviations and decimal numbers
  const sentences = cleaned
    .split(/([.!?]+(?:\s+|$|\n))/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  
  // Recombine sentences with their punctuation
  const result: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const current = sentences[i];
    
    // If this is just punctuation, attach it to the previous sentence
    if (/^[.!?]+$/.test(current)) {
      if (result.length > 0) {
        result[result.length - 1] += current;
      }
      continue;
    }
    
    // If current doesn't end with punctuation and next is punctuation, combine them
    if (i + 1 < sentences.length && /^[.!?]+$/.test(sentences[i + 1])) {
      result.push(current + sentences[i + 1]);
      i++; // Skip the punctuation-only item
    } else {
      result.push(current);
    }
  }
  
  // Filter out very short fragments (likely not complete sentences)
  // Minimum 3 characters for a sentence
  const filtered = result.filter((s) => s.trim().length >= 3);
  
  // If we filtered out everything, try a simpler split
  if (filtered.length === 0) {
    return cleaned
      .split(/[.!?]+\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3);
  }
  
  return filtered;
}

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

async function analyzeSentence(sentence: string): Promise<SentenceAnalysis> {
  // Run bias detection on the sentence
  const biasDetection = await runClassification(DETECTOR_MODEL, sentence);
  if (!biasDetection) {
    throw new Error('Failed to detect bias in sentence');
  }

  const isBiased = biasDetection.label.toLowerCase() === 'label_1' || 
                   friendlyLabel(biasDetection.label).toLowerCase() === 'biased';

  // Only run type classification if the sentence is biased
  let biasType: { label: string; score: number } | null = null;
  if (isBiased && biasDetection.score > 0.5) {
    try {
      const typeResult = await runClassification(TYPE_MODEL, sentence);
      if (typeResult) {
        biasType = {
          label: friendlyLabel(typeResult.label),
          score: typeResult.score,
        };
      }
    } catch (error) {
      console.warn('Bias type classification failed for sentence:', error);
      // Continue without type classification
    }
  }

  return {
    sentence,
    biasDetection: {
      label: biasDetection.label,
      friendlyLabel: friendlyLabel(biasDetection.label),
      score: biasDetection.score,
    },
    biasType,
  };
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

    // Split text into sentences
    const sentences = splitIntoSentences(text.trim());
    if (sentences.length === 0) {
      return NextResponse.json({ error: 'Could not extract sentences from text.' }, { status: 400 });
    }

    // Analyze each sentence
    const sentenceAnalyses: SentenceAnalysis[] = [];
    for (const sentence of sentences) {
      try {
        const analysis = await analyzeSentence(sentence);
        sentenceAnalyses.push(analysis);
      } catch (error) {
        console.warn('Failed to analyze sentence:', sentence, error);
        // Continue with other sentences even if one fails
      }
    }

    if (sentenceAnalyses.length === 0) {
      return NextResponse.json(
        { error: 'Failed to analyze any sentences.' },
        { status: 502 }
      );
    }

    // Calculate aggregate statistics
    const totalSentences = sentenceAnalyses.length;
    const biasedSentences = sentenceAnalyses.filter(
      (a) => a.biasDetection.friendlyLabel.toLowerCase() === 'biased' && a.biasDetection.score > 0.5
    ).length;
    const unbiasedSentences = totalSentences - biasedSentences;
    const biasPercentage = (biasedSentences / totalSentences) * 100;

    // Count bias types
    const biasTypeCounts: Record<string, number> = {};
    sentenceAnalyses.forEach((analysis) => {
      if (analysis.biasType) {
        const typeLabel = analysis.biasType.label;
        biasTypeCounts[typeLabel] = (biasTypeCounts[typeLabel] || 0) + 1;
      }
    });

    // Calculate average bias scores
    const avgBiasScore =
      sentenceAnalyses.reduce((sum, a) => sum + a.biasDetection.score, 0) / totalSentences;
    const avgBiasedScore =
      biasedSentences > 0
        ? sentenceAnalyses
            .filter((a) => a.biasDetection.friendlyLabel.toLowerCase() === 'biased')
            .reduce((sum, a) => sum + a.biasDetection.score, 0) / biasedSentences
        : 0;

    return NextResponse.json({
      text,
      sentences: sentenceAnalyses,
      statistics: {
        totalSentences,
        biasedSentences,
        unbiasedSentences,
        biasPercentage: Math.round(biasPercentage * 10) / 10,
        avgBiasScore: Math.round(avgBiasScore * 1000) / 1000,
        avgBiasedScore: Math.round(avgBiasedScore * 1000) / 1000,
        biasTypeCounts,
      },
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
