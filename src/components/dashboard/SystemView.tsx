import { Cpu, HardDrive, Thermometer, Wifi, Clock, MemoryStick } from "lucide-react";

const SystemView = () => {
  const sysInfo = [
    { icon: Cpu, label: "CPU", value: "23%", detail: "Cortex-A78AE × 12", bar: 23 },
    { icon: MemoryStick, label: "NPU", value: "67%", detail: "32 TOPS INT8", bar: 67 },
    { icon: HardDrive, label: "Memory", value: "6.2 / 16 GB", detail: "LPDDR5", bar: 39 },
    { icon: HardDrive, label: "Storage", value: "45 / 256 GB", detail: "NVMe SSD", bar: 18 },
    { icon: Thermometer, label: "Temperature", value: "42°C", detail: "Normal range", bar: 42 },
    { icon: Wifi, label: "Network", value: "1 Gbps", detail: "Ethernet", bar: 15 },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold mb-1">System</h1>
        <p className="text-muted-foreground">Hardware monitoring and diagnostics</p>
      </div>

      <div className="bg-surface rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-3 h-3 rounded-full bg-success animate-pulse" />
          <div>
            <p className="font-semibold">Atomo Electron E7K</p>
            <p className="text-sm text-muted-foreground font-mono">S/N: APU-2026-E7K3-9F1A • Uptime: 14d 7h 23m</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sysInfo.map((item) => (
            <div key={item.label} className="p-4 rounded-xl bg-muted/30 border border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <item.icon className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                <span className="text-sm font-mono font-bold">{item.value}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-atomic transition-all duration-1000"
                  style={{ width: `${item.bar}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">System Logs</h3>
        <div className="bg-background rounded-lg p-4 font-mono text-xs space-y-1 max-h-64 overflow-auto">
          {[
            "[14:32:01] INFO  camera.rtsp — Stream reconnected: Main Entrance",
            "[14:31:58] WARN  inference — NPU thermal throttle at 68°C",
            "[14:31:45] INFO  model.fire — Detection event: confidence 0.982",
            "[14:31:30] INFO  system — Health check: all services nominal",
            "[14:31:15] DEBUG npu — Batch inference: 8.2ms avg latency",
            "[14:31:00] INFO  camera.usb — Frame captured: 1920x1080@30fps",
          ].map((log, i) => (
            <p key={i} className={`${log.includes("WARN") ? "text-warning" : log.includes("DEBUG") ? "text-muted-foreground" : "text-foreground/70"}`}>
              {log}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SystemView;
