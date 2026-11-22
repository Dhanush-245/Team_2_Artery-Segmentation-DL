import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search } from "lucide-react";
import type { CaseRecord } from "../caseTypes";
import type { SidebarView } from "./watermelon/macos-sidebar";
import { SECTION_META } from "../sectionMeta";
import { caseStatusLabel } from "../caseTypes";

export type PaletteCommand = { id: string; group: "Sections" | "Cases" | "Actions"; label: string; hint?: string; run: () => void };

const MAX_RESULTS = 12;

function isPaletteShortcut(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";
}

export function buildCommands(options: {
  sections: SidebarView[];
  cases: CaseRecord[];
  openSection: (view: SidebarView) => void;
  openCase: (id: string) => void;
  actions: PaletteCommand[];
}): PaletteCommand[] {
  return [
    ...options.sections.map((view): PaletteCommand => ({ id: `section:${view}`, group: "Sections", label: SECTION_META[view].title, hint: SECTION_META[view].description, run: () => options.openSection(view) })),
    ...options.actions,
    ...options.cases.map((item): PaletteCommand => ({ id: `case:${item.id}`, group: "Cases", label: item.case_code, hint: `${item.modality} · ${item.anatomy} · ${caseStatusLabel(item)}`, run: () => options.openCase(item.id) })),
  ];
}

/** Global Cmd/Ctrl+K search: jump to any permitted section or authorized case. */
export default function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen((value) => !value);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else returnFocus.current?.focus?.();
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle ? commands.filter((command) => `${command.label} ${command.hint ?? ""} ${command.group}`.toLowerCase().includes(needle)) : commands.filter((command) => command.group !== "Cases");
    return matches.slice(0, MAX_RESULTS);
  }, [commands, query]);

  function choose(command: PaletteCommand | undefined) {
    if (!command) return;
    setOpen(false);
    command.run();
  }

  function onInputKey(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === "Enter") { event.preventDefault(); choose(results[active]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  }

  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
  return <>
    <button type="button" className="cv-palette-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Search sections and cases (${shortcut})`}>
      <Search size={16} aria-hidden="true" /><span>Search</span><kbd>{shortcut}</kbd>
    </button>
    {open && <div className="cv-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="cv-palette" role="dialog" aria-modal="true" aria-label="Search sections and cases">
        <div className="cv-palette-input"><Search size={18} aria-hidden="true" />
          <input ref={inputRef} value={query} placeholder="Jump to a section or case…" role="combobox" aria-expanded="true" aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onInputKey} />
          <kbd>Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results">
          {results.map((command, index) => <li key={command.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
            className={index === active ? "is-active" : ""} onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); choose(command); }}>
            <span className="cv-palette-group">{command.group}</span><strong>{command.label}</strong>{command.hint && <small>{command.hint}</small>}
          </li>)}
          {!results.length && <li className="cv-palette-empty" role="presentation">No sections or cases match “{query}”.</li>}
        </ul>
      </div>
    </div>}
  </>;
}
