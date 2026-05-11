import { Bell, Shield, Webhook, FileDown, Users, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const SettingsView = ({ onResetAll }: { onResetAll: () => void }) => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold mb-1">Settings</h1>
        <p className="text-muted-foreground">Device configuration and integrations</p>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-foreground">Reset local data</div>
            <div className="text-sm text-muted-foreground">
              Clears saved cameras, saved events, and unlinks any export folder on this browser. Use this when you want a clean start.
            </div>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Reset everything…</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset everything?</AlertDialogTitle>
              <AlertDialogDescription>
                This will stop any running AI sessions, delete all cameras and all detection events from this browser, and unlink the disk export folder (if linked).
                Exported files already written to disk will remain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onResetAll}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="space-y-4">
        {[
          { icon: Bell, title: "Alert Configuration", desc: "Set up alert triggers, thresholds, and notification channels" },
          { icon: Webhook, title: "Webhook Integration", desc: "Configure HTTP webhooks for real-time event forwarding" },
          { icon: Shield, title: "MQTT Output", desc: "Send detection events to an MQTT broker" },
          { icon: FileDown, title: "CSV Export", desc: "Export detection data and analytics reports" },
          { icon: Users, title: "Role-Based Access", desc: "Manage user accounts and permission levels" },
        ].map((item) => (
          <button
            key={item.title}
            className="w-full bg-surface rounded-xl p-5 flex items-center gap-4 text-left hover:border-primary/30 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <item.icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </div>
            <span className="text-muted-foreground">→</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SettingsView;
