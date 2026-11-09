import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useStore } from "../app/store";
import { ui } from "../app/controller";

export function Toast() {
  const { toast } = useStore(ui);
  if (!toast) return null;
  const Icon = toast.tone === "error" ? TriangleAlert : toast.tone === "success" ? CircleCheck : Info;
  return (
    <div className={`toast toast-${toast.tone}`} key={toast.id} role="status">
      <Icon size={15} />
      <span>{toast.text}</span>
    </div>
  );
}
