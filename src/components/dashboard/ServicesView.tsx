import { useMemo, useState } from "react";
import { Plus, Search, User, Camera, Pencil, Trash2 } from "lucide-react";

type ServiceId =
  | "anpr-gpu"
  | "face-recognition-gpu"
  | "intrusion-detection-gpu"
  | "edge-protection-gpu"
  | "ppe-no-boot-gpu"
  | "ppe-2-classes-gpu";

const ServicesView = () => {
  const services = [
    { id: "anpr-gpu" as const, name: "Automatic Number Plate Detection Gpu", color: "bg-destructive" },
    { id: "face-recognition-gpu" as const, name: "Face Recognition Gpu", color: "bg-success" },
    { id: "intrusion-detection-gpu" as const, name: "Intrusion Detection Gpu", color: "bg-destructive" },
    { id: "edge-protection-gpu" as const, name: "Edge Protection GPU", color: "bg-success" },
    { id: "ppe-no-boot-gpu" as const, name: "PPE Kit Detection No Boot Gpu", color: "bg-warning" },
    { id: "ppe-2-classes-gpu" as const, name: "Ppe Kit Detection 2 Classes Gpu", color: "bg-success" },
  ];

  const [selectedService, setSelectedService] = useState<ServiceId>("face-recognition-gpu");
  const [serviceEnabled, setServiceEnabled] = useState(true);
  const [tab, setTab] = useState<"user" | "camera">("user");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"authorized" | "blacklisted" | "unauthorized">("authorized");
  const [page, setPage] = useState(1);

  const utilization = {
    cpu: 3.6,
    ram: 33.3,
    mem: 23.55,
  };

  const selectedServiceName = useMemo(
    () => services.find((s) => s.id === selectedService)?.name ?? "Service",
    [selectedService]
  );

  const users = [
    { id: "003", name: "Chandar…", type: "Employee", department: "Shaksham Raj…", camera: "—", validTill: "—" },
    { id: "005", name: "Chanda…", type: "Employee", department: "Electrical", camera: "—", validTill: "—" },
  ];

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.id} ${u.name} ${u.type} ${u.department}`.toLowerCase().includes(q));
  }, [query]);

  const smallMetric = (label: string, value: number) => (
    <div className="bg-surface rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(2).replace(/\.00$/, "")}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-success" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {smallMetric("Cpu Utilization", utilization.cpu)}
        {smallMetric("Ram Utilization", utilization.ram)}
        {smallMetric("Memory Utilization", utilization.mem)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-3">
          <div className="bg-surface rounded-xl overflow-hidden border border-border">
            <button className="w-full px-4 py-3 bg-foreground text-background text-sm font-semibold flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> Add Service
            </button>
            <div className="p-2">
              {services.map((s) => {
                const active = s.id === selectedService;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedService(s.id);
                      setPage(1);
                      setQuery("");
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
                      active ? "bg-muted" : "hover:bg-muted/60"
                    }`}
                  >
                    <div className={`w-1.5 h-8 rounded-full ${s.color}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-9">
          <div className="bg-surface rounded-xl border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-base font-semibold text-foreground truncate">{selectedServiceName}</div>
                <button
                  onClick={() => setServiceEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    serviceEnabled ? "bg-success" : "bg-muted-foreground/40"
                  }`}
                  aria-label="Toggle service"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${
                      serviceEnabled ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button className="h-9 w-9 rounded-lg border border-border bg-card hover:bg-muted transition-colors" aria-label="Info" />
                <button className="h-9 w-9 rounded-lg border border-border bg-card hover:bg-muted transition-colors" aria-label="Clock" />
                <button className="h-9 w-9 rounded-lg border border-border bg-card hover:bg-muted transition-colors" aria-label="Expand" />
              </div>
            </div>

            <div className="px-5 pt-4">
              <div className="grid grid-cols-2 bg-muted/50 rounded-xl overflow-hidden border border-border">
                <button
                  onClick={() => setTab("user")}
                  className={`py-3 text-sm font-semibold ${
                    tab === "user" ? "bg-card text-foreground border-b-2 border-warning" : "text-muted-foreground"
                  }`}
                >
                  User
                </button>
                <button
                  onClick={() => setTab("camera")}
                  className={`py-3 text-sm font-semibold ${
                    tab === "camera" ? "bg-card text-foreground border-b-2 border-warning" : "text-muted-foreground"
                  }`}
                >
                  Camera
                </button>
              </div>
            </div>

            <div className="p-5">
              {tab === "user" ? (
                <>
                  <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                    <div className="relative w-full lg:max-w-md">
                      <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(1);
                        }}
                        placeholder="Search user…"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setFilter("authorized")}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${
                          filter === "authorized"
                            ? "bg-success/10 text-success border-success/20"
                            : "bg-card text-muted-foreground border-border hover:bg-muted/50"
                        }`}
                      >
                        Authorized
                      </button>
                      <button
                        onClick={() => setFilter("blacklisted")}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${
                          filter === "blacklisted"
                            ? "bg-destructive/10 text-destructive border-destructive/20"
                            : "bg-card text-muted-foreground border-border hover:bg-muted/50"
                        }`}
                      >
                        Blacklisted
                      </button>
                      <button
                        onClick={() => setFilter("unauthorized")}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${
                          filter === "unauthorized"
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "bg-card text-muted-foreground border-border hover:bg-muted/50"
                        }`}
                      >
                        Unauthorized
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-foreground text-background">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">User ID</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">User Name</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">User Type</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">Department</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">Camera</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">Valid Till</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr key={u.id} className="border-t border-border bg-card">
                            <td className="px-3 py-3">
                              <span className="inline-flex items-center justify-center min-w-10 px-2 py-1 rounded border border-primary/30 bg-primary/5 text-primary text-xs font-mono">
                                {u.id}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                                  <User className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <span className="truncate">{u.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{u.type}</td>
                            <td className="px-3 py-3 text-muted-foreground">{u.department}</td>
                            <td className="px-3 py-3 text-muted-foreground">{u.camera}</td>
                            <td className="px-3 py-3 text-muted-foreground">{u.validTill}</td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <button className="h-8 w-8 rounded-md border border-border bg-card hover:bg-muted transition-colors" aria-label="Edit">
                                  <Pencil className="w-4 h-4 mx-auto text-muted-foreground" />
                                </button>
                                <button
                                  className="h-8 w-8 rounded-md bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
                                  aria-label="Delete"
                                >
                                  <Trash2 className="w-4 h-4 mx-auto" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredUsers.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground bg-card">
                              No users match your search.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      className="h-8 w-8 rounded border border-border bg-card text-muted-foreground hover:bg-muted transition-colors"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      ‹
                    </button>
                    <div className="h-8 min-w-8 px-2 rounded border border-warning bg-card text-foreground flex items-center justify-center text-xs font-semibold">
                      {page}
                    </div>
                    <button
                      className="h-8 w-8 rounded border border-border bg-card text-muted-foreground hover:bg-muted transition-colors"
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Next page"
                    >
                      ›
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
                  <div className="mx-auto w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-3">
                    <Camera className="w-5 h-5 text-muted-foreground" />
                  </div>
                  Camera configuration UI will appear here next.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServicesView;

