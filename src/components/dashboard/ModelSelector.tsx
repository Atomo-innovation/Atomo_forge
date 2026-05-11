import { Zap } from "lucide-react";
import type { ModelInfo } from "@/data/models";

interface Props {
  selected: string | null;
  onSelect: (id: string) => void;
  models: ModelInfo[];
}

const ModelSelector = ({ selected, onSelect, models }: Props) => {
  return (
    <div className="bg-surface rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Select AI Model</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {models.map((model) => {
          const isSelected = selected === model.id;
          return (
            <button
              key={model.id}
              onClick={() => onSelect(model.id)}
              className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                isSelected
                  ? "border-primary bg-primary/10 glow-primary-sm"
                  : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <model.icon className={`w-5 h-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                <span className="font-semibold text-sm">{model.name}</span>
              </div>
              {model.id !== "custom" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{model.version ?? "—"}</span>
                    {model.npuOptimized && (
                      <span className="flex items-center gap-1 text-accent text-[10px] font-medium">
                        <Zap className="w-3 h-3" /> NPU
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {typeof model.accuracy === "number" ? `${model.accuracy}% acc` : "—"} •{" "}
                    {typeof model.fps === "number" ? `${model.fps} FPS` : "—"} •{" "}
                    {typeof model.compute === "number" ? `${model.compute}% compute` : "—"}
                  </p>
                </div>
              )}
              {model.id === "custom" && (
                <p className="text-xs text-muted-foreground">Upload ONNX / TensorRT model</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModelSelector;
