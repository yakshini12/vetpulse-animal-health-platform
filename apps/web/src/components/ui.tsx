import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../api/client.js';
import { badgeClass, humanize } from '../lib/format.js';

/** Coloured status pill. */
export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${badgeClass(value)}`}>{humanize(value)}</span>;
}

/** Error banner for ApiError/NetworkError and plain fallbacks. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? `${error.message}${error.code ? ` (${error.code})` : ''}`
      : error instanceof NetworkError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Something went wrong.';
  return <div className="alert alert-error" role="alert">{message}</div>;
}

/** Inline confirmation banner. */
export function OkAlert({ children }: { children: ReactNode }) {
  return <div className="alert alert-ok">{children}</div>;
}

/** Spinner-free loading row. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function Empty({ children = 'Nothing to show.' }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

interface PageProps<T> {
  data: PageShape<T> | null;
  onPage: (page: number) => void;
}

export interface PageShape<T> {
  items: T[];
  page: number;
  total: number;
  totalPages: number;
}

/** Shared bottom pagination for list pages. */
export function Pager<T>({ data, onPage }: PageProps<T>) {
  if (!data) return null;
  return (
    <div className="pager">
      <span>
        Page {data.page} of {data.totalPages} · {data.total} record{data.total === 1 ? '' : 's'}
      </span>
      <button type="button" className="btn btn-sm" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
        ← Prev
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={data.page >= data.totalPages}
        onClick={() => onPage(data.page + 1)}
      >
        Next →
      </button>
    </div>
  );
}

interface ModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Accessibility-light modal used for forms across pages. */
export function Modal({ title, open, onClose, children }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Labeled form field wrapper. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Sort header for tables; toggles asc/desc via onChange. */
export function SortTh({
  field,
  label,
  current,
  order,
  onChange,
}: {
  field: string;
  label: string;
  current: string;
  order: 'asc' | 'desc';
  onChange: (field: string) => void;
}) {
  const arrow = current === field ? (order === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th className="sortable" onClick={() => onChange(field)}>
      {label}
      {arrow}
    </th>
  );
}
