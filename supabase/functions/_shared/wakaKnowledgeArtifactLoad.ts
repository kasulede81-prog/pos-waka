import type { WakaKnowledgeArtifact } from "./askWakaKnowledge.ts";
import raw from "./wakaKnowledgeArtifact.json" with { type: "json" };

export const WAKA_KNOWLEDGE_ARTIFACT = raw as WakaKnowledgeArtifact;
