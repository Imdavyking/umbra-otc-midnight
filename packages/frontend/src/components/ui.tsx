import { useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import { errMsg } from "../lib/utils";

export const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border rounded-2xl p-5 bg-white shadow-sm">
    <h3 className="text-lg font-semibold mb-3">{title}</h3>
    <div className="space-y-3">{children}</div>
  </section>
);

export const Field = ({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="block text-sm">
    <span className="text-gray-600">{label}</span>
    <input
      {...props}
      className="mt-1 w-full border rounded-lg px-3 py-2 font-mono text-sm"
    />
  </label>
);

/** Button that runs an async action, shows a spinner label, and toasts the outcome. */
export function ActionButton({
  children,
  run,
  done,
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  run: () => Promise<unknown>;
  done?: string;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await run();
          toast.success(done ?? "Done");
        } catch (e) {
          toast.error(errMsg(e));
        } finally {
          setBusy(false);
        }
      }}
      className={`px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50 ${
        variant === "primary"
          ? "bg-indigo-700 text-white hover:bg-indigo-800"
          : "border text-gray-700 hover:bg-gray-50"
      }`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.info("Copied");
  } catch {
    toast.error("Copy failed");
  }
};

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-xs break-all">{children}</span>
);
