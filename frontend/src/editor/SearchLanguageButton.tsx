import React, { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import type { SearchLanguageControl } from "./searchLanguages";

const MAX_CODES = 3;

const LanguageCode: React.FC<{ language: string }> = ({ language }) => (
  <span className="lang-code" data-language={language}>{language.toUpperCase()}</span>
);

/** The language button at the right edge of the search box, and its checkbox list. */
export const SearchLanguageButton: React.FC<{ control: SearchLanguageControl }> = ({ control }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // English is the ontology itself: always searched, always shown first.
  const shown = ["en", ...control.active];
  const codes = shown.slice(0, MAX_CODES);
  const more = shown.length - codes.length;
  const name = `Search languages: ${shown.map((code) => code.toUpperCase()).join(", ")}`;

  return (
    <div
      className="search-language"
      ref={rootRef}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <Button
        variant="quiet"
        size="sm"
        ref={buttonRef}
        type="button"
        className="search-language-button"
        aria-label={name}
        aria-haspopup="true"
        aria-expanded={open}
        title={name}
        onClick={() => setOpen((value) => !value)}
      >
        {codes.map((code) => (
          <LanguageCode key={code} language={code} />
        ))}
        {more > 0 && <span className="lang-code">+{more}</span>}
      </Button>
      {open && (
        <div className="search-language-menu" role="group" aria-label="Search languages">
          <label className="search-language-option" title="The names of the ontology itself are always searched">
            <input type="checkbox" checked disabled readOnly />
            <LanguageCode language="en" />
          </label>
          {control.options.map((option) => (
            <label
              key={option.language}
              className="search-language-option"
              title={`${option.termCount.toLocaleString("en-US")} terms have a name in this language`}
            >
              <input
                type="checkbox"
                checked={control.active.includes(option.language)}
                onChange={() => control.onToggle(option.language)}
              />
              <LanguageCode language={option.language} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
