import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto my-12 w-full max-w-md px-4">
      <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function Field({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string[] | undefined;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        className="w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 aria-invalid:border-red-500"
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select className="w-full rounded-md border border-stone-300 bg-white px-3 py-2" {...props}>
        {children}
      </select>
    </label>
  );
}

export function Button({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="w-full rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      {...props}
    >
      {children}
    </button>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}
