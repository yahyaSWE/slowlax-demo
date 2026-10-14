"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, UserRound } from "lucide-react";
import type { AdminStudentChoice } from "@/lib/admin-students";
import "./student-picker.css";

function searchable(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sv-SE");
}

export function StudentPicker({
  id,
  students,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  students: AdminStudentChoice[];
  value: string;
  onChange: (email: string) => void;
  disabled?: boolean;
}) {
  const panelId = useId();
  const searchId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = students.find(student => student.email.toLowerCase() === value.toLowerCase());
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  const matches = students.filter(student => {
    const text = searchable(`${student.name} ${student.email}`);
    return words.every(word => text.includes(word));
  });

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }
  function choose(student: AdminStudentChoice) {
    if (!student.emailVerified || disabled) return;
    onChange(student.email);
    setQuery("");
    close();
  }

  return (
    <div className="student-picker" onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); close(); }
    }}>
      <button
        id={id}
        ref={toggle}
        type="button"
        className="student-picker-toggle"
        disabled={disabled}
        aria-label={selected ? "Byt elev" : "Välj elev"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(current => !current)}
      >
        <UserRound size={19} aria-hidden="true" />
        <span>
          {selected ? <><strong>{selected.name}</strong><small>{selected.email}</small></> : "Välj elev"}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="student-picker-panel" role="region" aria-label="Registrerade elever">
          <label htmlFor={searchId}>Sök elev</label>
          <div className="student-picker-search">
            <Search size={17} aria-hidden="true" />
            <input
              id={searchId}
              ref={search}
              type="search"
              autoComplete="off"
              placeholder="Sök namn eller e-postadress"
              value={query}
              disabled={disabled}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (matches.length === 1) choose(matches[0]);
                }
              }}
            />
          </div>
          <p className="student-picker-count" role="status" aria-live="polite">
            {matches.length} av {students.length} registrerade elever
          </p>
          {matches.length ? (
            <ul className="student-picker-results">
              {matches.map(student => (
                <li key={student.id}>
                  <button
                    type="button"
                    className="student-picker-result"
                    disabled={disabled || !student.emailVerified}
                    aria-pressed={selected?.id === student.id}
                    onClick={() => choose(student)}
                  >
                    <span>
                      <strong>{student.name}</strong>
                      <small>{student.email}</small>
                      {!student.emailVerified && <small className="student-picker-unverified">E-post behöver verifieras</small>}
                    </span>
                    {selected?.id === student.id && <Check size={18} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="student-picker-empty">
              {students.length ? "Ingen elev matchar din sökning." : "Det finns inga registrerade elever ännu."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
