import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../lib/i18n";

// Frosted popovers for the intro: a listbox for the chips and a combobox for search.

export type Option = { id: string; label: string };
export type SearchEntry = { label: string; norm: string; lon: number; lat: number; segIndex: number | null };

function place(anchor: DOMRect, rootWidth: number, width: number, alignRight: boolean): { left: number; top: number } {
  const wanted = alignRight ? anchor.right - width : anchor.left;
  return { left: Math.max(8, Math.min(rootWidth - width - 8, wanted)), top: anchor.bottom + 8 };
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function step(key: string, active: number, count: number): number | null {
  if (key === "ArrowDown") return (active + 1) % count;
  if (key === "ArrowUp") return (active + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

type ListProps = {
  id: string;
  label: string;
  options: Option[];
  selected: string;
  anchor: DOMRect;
  rootWidth: number;
  onPick: (id: string) => void;
  onClose: () => void;
};

export function ListPopover({ id, label, options, selected, anchor, rootWidth, onPick, onClose }: ListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(Math.max(0, options.findIndex((o) => o.id === selected)));
  const pos = place(anchor, rootWidth, 240, false);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    document.getElementById(`${id}-o${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      onClose();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[active];
      if (option) onPick(option.id);
      return;
    }
    const next = step(event.key, active, options.length);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  };

  return (
    <>
      <div className="intro-pop-scrim" onClick={onClose} />
      <ul
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${id}-o${active}`}
        tabIndex={-1}
        className="intro-pop intro-ui"
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={onKey}
      >
        {options.map((option, i) => (
          <li
            key={option.id}
            id={`${id}-o${i}`}
            role="option"
            aria-selected={option.id === selected}
            className={i === active ? "intro-pop__opt intro-pop__opt--on" : "intro-pop__opt"}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(option.id)}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </>
  );
}

type SearchProps = {
  entries: SearchEntry[];
  anchor: DOMRect;
  rootWidth: number;
  onPick: (entry: SearchEntry) => void;
  onClose: () => void;
};

export function SearchPanel({ entries, anchor, rootWidth, onPick, onClose }: SearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const width = Math.min(320, rootWidth - 16);
  const pos = place(anchor, rootWidth, width, true);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    const starts: SearchEntry[] = [];
    const contains: SearchEntry[] = [];
    for (const entry of entries) {
      if (entry.norm.startsWith(q)) starts.push(entry);
      else if (entry.norm.includes(q)) contains.push(entry);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [entries, query]);

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[active];
      if (entry) onPick(entry);
      return;
    }
    if (results.length === 0) return;
    const next = step(event.key, active, results.length);
    if (next !== null && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive(next);
    }
  };

  const listId = "intro-search-list";
  return (
    <>
      <div className="intro-pop-scrim" onClick={onClose} />
      <div className="intro-pop intro-pop--search intro-ui" style={{ left: pos.left, top: pos.top, width }}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? `intro-search-o${active}` : undefined}
          aria-label={t("Search streets and neighbourhoods")}
          placeholder={t("Search streets and neighbourhoods")}
          className="intro-pop__input"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <ul id={listId} role="listbox" aria-label={t("Search")} className="intro-pop__list">
          {results.map((entry, i) => (
            <li
              key={`${entry.label}-${i}`}
              id={`intro-search-o${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "intro-pop__opt intro-pop__opt--on" : "intro-pop__opt"}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(entry)}
            >
              {entry.label}
            </li>
          ))}
        </ul>
        {query.trim() !== "" && results.length === 0 && <span className="intro-pop__none">{t("No matches")}</span>}
      </div>
    </>
  );
}
