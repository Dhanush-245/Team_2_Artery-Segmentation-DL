import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { currentToasts, dismissToast, subscribeToasts } from "../lib/toast";

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info };

/** Announces action results (upload, analysis, export, review) without moving focus. */
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts);
  return <div className="cv-toaster" role="region" aria-label="Notifications" aria-live="polite">
    {toasts.map((item) => {
      const Icon = ICONS[item.tone];
      return <div key={item.id} className={`cv-toast cv-toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
        <Icon size={18} aria-hidden="true" />
        <span>{item.message}</span>
        <button type="button" aria-label="Dismiss notification" onClick={() => dismissToast(item.id)}><X size={16} aria-hidden="true" /></button>
      </div>;
    })}
  </div>;
}
