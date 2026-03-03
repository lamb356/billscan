import Tesseract from 'tesseract.js';

interface OcrResult {
  text: string;
  confidence: number;
}

export async function ocrImage(imagePath: string): Promise<OcrResult> {
  const worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
  try {
    const { data } = await worker.recognize(imagePath);
    return { text: data.text, confidence: (data.confidence ?? 0) / 100 };
  } finally {
    await worker.terminate();
  }
}
