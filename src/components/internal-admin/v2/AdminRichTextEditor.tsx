import { useCallback, useEffect, useRef } from "react";
import { Bold, Italic, List } from "lucide-react";
import clsx from "clsx";

type Props = {
  label: string;
  hint?: string;
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  variant?: "public" | "internal";
  minHeightClass?: string;
};

export function AdminRichTextEditor({
  label,
  hint,
  value,
  onChange,
  disabled = false,
  variant = "public",
  minHeightClass = "min-h-[140px]",
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastExternalValue = useRef(value);

  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastExternalValue.current) {
      editorRef.current.innerHTML = value;
      lastExternalValue.current = value;
    }
  }, [value]);

  const exec = useCallback(
    (command: string) => {
      if (disabled) return;
      document.execCommand(command, false);
      editorRef.current?.focus();
      onChange(editorRef.current?.innerHTML ?? "");
    },
    [disabled, onChange],
  );

  const handleInput = () => {
    const html = editorRef.current?.innerHTML ?? "";
    lastExternalValue.current = html;
    onChange(html);
  };

  return (
    <div
      className={clsx(
        "rounded-2xl border bg-white shadow-sm",
        variant === "internal" ? "border-amber-200" : "border-stone-200",
      )}
    >
      <div
        className={clsx(
          "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2",
          variant === "internal" ? "border-amber-100 bg-amber-50/80" : "border-stone-100 bg-stone-50/80",
        )}
      >
        <div>
          <p className="text-sm font-black text-stone-900">{label}</p>
          {hint ? <p className="text-xs font-medium text-stone-500">{hint}</p> : null}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => exec("bold")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            aria-label="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => exec("italic")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            aria-label="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => exec("insertUnorderedList")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            aria-label="Bullet list"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        className={clsx(
          "prose prose-sm max-w-none px-4 py-3 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-waka-200",
          minHeightClass,
          disabled && "opacity-60",
        )}
      />
    </div>
  );
}
