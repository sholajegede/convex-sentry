import type { ReactNode } from "react";
import { statusLabel, type Status } from "../lib/types";

export function Card(props: {
  title?: string;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`card${props.className ? ` ${props.className}` : ""}`}>
      {props.title && <h2>{props.title}</h2>}
      {props.description && <p className="card-desc">{props.description}</p>}
      {props.children}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "small";
}) {
  const classes = [
    "btn",
    props.variant === "secondary" && "secondary",
    props.size,
  ].filter(Boolean);
  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function StatusPill(props: { status: Status }) {
  return (
    <span className={`pill ${props.status}`}>{statusLabel(props.status)}</span>
  );
}

export function Level(props: { level: string }) {
  return <span className={`level ${props.level}`}>{props.level}</span>;
}

export function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1.5 14.5 13H1.5L8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M8 6v3.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.2" r="0.9" fill="currentColor" />
      </svg>
    </span>
  );
}
