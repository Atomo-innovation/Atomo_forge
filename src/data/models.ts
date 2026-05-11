import { Flame, User, Users, HardHat, Car, Upload, Brain } from "lucide-react";

export interface ModelInfo {
  id: string;
  name: string;
  icon: React.ElementType;
  version?: string;
  accuracy?: number;
  fps?: number;
  compute?: number;
  npuOptimized?: boolean;
  classes?: string[];
  dir?: string;
  nb?: string;
  lib?: string;
  nb_path?: string;
  lib_path?: string;
  yaml?: string | null;
}

// If you want a local fallback list again, reintroduce it here and update `useModels()`.
export const legacyHardcodedModels: ModelInfo[] = [
  { id: "fire", name: "Fire Detection", icon: Flame, version: "v3.2", accuracy: 97.8, fps: 45, compute: 23, npuOptimized: true },
  { id: "face", name: "Face Detection", icon: User, version: "v4.1", accuracy: 99.1, fps: 60, compute: 18, npuOptimized: true },
  { id: "crowd", name: "Crowd Analytics", icon: Users, version: "v2.0", accuracy: 94.5, fps: 30, compute: 35, npuOptimized: true },
  { id: "ppe", name: "PPE Detection", icon: HardHat, version: "v3.0", accuracy: 96.3, fps: 40, compute: 28, npuOptimized: true },
  { id: "vehicle", name: "Vehicle Detection", icon: Car, version: "v2.5", accuracy: 95.7, fps: 35, compute: 31, npuOptimized: false },
  { id: "custom", name: "Custom Model", icon: Upload, version: "—", accuracy: 0, fps: 0, compute: 0, npuOptimized: false },
];

export const universalModelIcon = Brain;

