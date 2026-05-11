import { useEffect, useState } from "react";
import { DETECTION_EVENTS_CHANGED_EVENT, countDetectionEventsByCamera } from "@/services/detectionEventsStore";

const stats = [
  { label: "Active Objects", value: "14", color: "text-primary" },
  { label: "Avg Confidence", value: "96.3%", color: "text-accent" },
  { label: "Inference Time", value: "8.2ms", color: "text-success" },
  { label: "NPU Utilization", value: "67%", color: "text-primary" },
  { label: "Alerts Triggered", value: "3", color: "text-warning" },
] as const;

const LiveStats = ({ connection, cameraId }: { connection: string; cameraId: string }) => {
  const [totalDetections, setTotalDetections] = useState<number>(0);

  useEffect(() => {
    const reload = () => void countDetectionEventsByCamera(cameraId).then(setTotalDetections).catch(() => setTotalDetections(0));
    reload();
    const onChanged = () => reload();
    window.addEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
  }, [cameraId]);

  return (
    <div className="bg-surface rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Live Statistics</h3>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Connection</span>
          <span className="text-sm font-mono font-bold text-foreground">{connection}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Total Detections</span>
          <span className="text-sm font-mono font-bold text-foreground">{totalDetections.toLocaleString()}</span>
        </div>
        {stats.map((stat) => (
          <div key={stat.label} className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{stat.label}</span>
            <span className={`text-sm font-mono font-bold ${stat.color}`}>{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LiveStats;
