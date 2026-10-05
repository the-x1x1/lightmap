'use client';
/**
 * A project's notes and shoot date (plan §4 "Projects: name, optional shoot date, notes"), edited
 * in place: the notes save when the field loses focus (or on Ctrl/⌘+Enter), the date half a
 * second after the last change (a keyboard-edited date input emits a value per keystroke). Saves
 * are chained so the last edit always wins, and "saved" is judged against what this component
 * last sent, not against the list's refetch. Keyed on the project id by the caller, so switching
 * projects resets the drafts.
 */
import { useEffect, useRef, useState } from 'react';
import type { ProjectDto } from '@/lib/api-types';

const NOTES_MAX = 2000;
const DATE_SETTLE_MS = 500;

type Patch = { description?: string | null; shootDate?: string | null };

export function ProjectNotes({
  project,
  onSave,
  busy,
}: {
  project: ProjectDto;
  /** Resolves when the server has the change; rejects with the API error. */
  onSave: (patch: Patch) => Promise<unknown>;
  busy: boolean;
}) {
  const [notes, setNotes] = useState(project.description ?? '');
  const [date, setDate] = useState(project.shootDate ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // What the server holds, as far as this component knows (the API trims notes).
  const [savedNotes, setSavedNotes] = useState(project.description ?? '');
  const dirty = notes.trim() !== savedNotes;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const dateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Chain the save behind any in-flight one so the last edit lands last. */
  const save = (patch: Patch, onDone?: () => void) => {
    setState('saving');
    const run = queue.current
      .then(() => onSave(patch))
      .then(
        () => {
          onDone?.();
          setState('saved');
        },
        () => setState('failed'),
      );
    queue.current = run;
  };
  const commitNotes = () => {
    if (!dirty) return;
    const trimmed = notes.trim();
    save({ description: trimmed === '' ? null : trimmed }, () => setSavedNotes(trimmed));
  };
  const changeDate = (value: string) => {
    setDate(value);
    if (dateTimer.current) clearTimeout(dateTimer.current);
    dateTimer.current = setTimeout(() => {
      dateTimer.current = null;
      save({ shootDate: value || null });
    }, DATE_SETTLE_MS);
  };
  useEffect(() => {
    const timer = dateTimer;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <details className="group" data-testid="project-notes">
      <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
        Notes &amp; shoot date
        {project.description ? (
          <span className="ml-2 normal-case tracking-normal text-[var(--lm-text-faint)]">
            {project.description.length > 40
              ? `${project.description.slice(0, 40)}…`
              : project.description}
          </span>
        ) : null}
      </summary>
      <div className="mt-2 space-y-2">
        <label className="block text-xs text-[var(--lm-text-muted)]">
          Shoot date
          <input
            type="date"
            value={date}
            onChange={(e) => changeDate(e.target.value)}
            className="mt-1 block h-11 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm text-[var(--lm-text)] focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            data-testid="project-shoot-date"
          />
        </label>
        <label className="block text-xs text-[var(--lm-text-muted)]">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commitNotes();
              }
            }}
            rows={4}
            maxLength={NOTES_MAX}
            placeholder="Access, parking, permits, the shot list — anything for the day."
            className="mt-1 block w-full rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 py-2 text-sm text-[var(--lm-text)] focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            data-testid="project-notes-text"
          />
        </label>
        <p
          className="text-xs text-[var(--lm-text-faint)]"
          role="status"
          data-testid="project-notes-status"
        >
          {state === 'saving' || busy
            ? 'Saving…'
            : state === 'failed'
              ? 'Not saved — check the connection and try again.'
              : dirty
                ? 'Unsaved — saves when you leave the field (Ctrl/⌘+Enter).'
                : state === 'saved'
                  ? 'Saved.'
                  : `${notes.length}/${NOTES_MAX}`}
        </p>
      </div>
    </details>
  );
}
