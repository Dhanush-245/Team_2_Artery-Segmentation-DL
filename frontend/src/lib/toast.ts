/** Minimal toast store: any module can announce an action result without prop drilling. */
export type ToastTone = "success" | "error" | "info";
export type Toast = { id: number; tone: ToastTone; message: string };

const TOAST_MS = 5000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function showToast(message: string, tone: ToastTone = "success") {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, tone, message }];
  emit();
  window.setTimeout(() => dismissToast(id), TOAST_MS);
}

export const toast = {
  success: (message: string) => showToast(message, "success"),
  error: (message: string) => showToast(message, "error"),
  info: (message: string) => showToast(message, "info"),
};

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const currentToasts = () => toasts;
