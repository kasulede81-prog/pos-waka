import { registerPlugin } from "@capacitor/core";

/** One ML Kit text block (often a paragraph or column). */
export type OcrTextBlock = {
  text: string;
  lines: string[];
  /** Native ML Kit element confidence when exposed by the SDK; otherwise omitted. */
  mlConfidence?: number;
};

export type RecognizeTextResult = {
  fullText: string;
  blocks: OcrTextBlock[];
};

export interface WakaMlkitOcrPlugin {
  isAvailable(): Promise<{ available: boolean; latinScript?: boolean }>;
  recognizeText(options: { imagePath: string }): Promise<RecognizeTextResult>;
}

export const WakaMlkitOcr = registerPlugin<WakaMlkitOcrPlugin>("WakaMlkitOcr", {
  web: () => ({
    isAvailable: async () => ({ available: false, latinScript: false }),
    recognizeText: async () => {
      throw new Error("WakaMlkitOcr runs only in the native Android app.");
    },
  }),
});
