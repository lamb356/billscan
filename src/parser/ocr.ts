import Tesseract from 'tesseract.js';

export async function ocrImage(imagePath: string): Promise<string> {
  const result = await Tesseract.recognize(imagePath, 'eng');
  return result.data.text;
}
