import { markPanel } from "@sitepilot/core";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { renderMarkdown } from "./markdown";
import CSS from "./widget.css";
import { usePilot, useSitepilot } from "./provider";

const STYLE_ID = "sitepilot-widget-css";
const CLOSE_MS = 180;

function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const Icon = {
  spark: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.7L19.5 9.5l-5.7 1.8L12 17l-1.8-5.7L4.5 9.5l5.7-1.8L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14zM5 15l.7 2 2 .7-2 .7L5 20.5l-.7-2-2-.7 2-.7L5 15z" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  reset: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    </svg>
  ),
  send: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  check: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  eye: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  ),
};

const TOOL_LABELS: Record<string, string> = {
  highlight_element: "Point",
  click_element: "Click",
  fill_field: "Type",
  computer: "Screenshot",
};

export interface SitepilotWidgetProps {
  title?: string;
  /** Small line under the title when idle. Default "Ready"; empty hides it. */
  subtitle?: string;
  placeholder?: string;
  /** Shown before the first message; a blank line splits it into heading and body. */
  welcome?: string;
  defaultOpen?: boolean;
  /** Show the per-tool consent chips. Default true. */
  showToolToggles?: boolean;
  /** Show the header button that outlines what the AI is sent from this page. Default true. */
  showSeenToggle?: boolean;
  /** How the eye view names who answered a message, from the completion's `model`. Default: the model name. */
  modelLabel?: (model: string) => ReactNode;
  /** Labels for the consent chips, by tool name. Merged over the built-in labels. */
  toolLabels?: Record<string, string>;
  /** Rendered under the composer, e.g. a "Powered by" line. */
  footer?: ReactNode;
  /** Replace the launcher/avatar icon. */
  icon?: ReactNode;
}

export function SitepilotWidget({
  title = "Assistant",
  subtitle = "Ready",
  placeholder = "Ask where something is, or what to do…",
  welcome = "Hi! Ask me where anything is on this page and I can point at it, or do it for you.",
  defaultOpen = false,
  showToolToggles = true,
  showSeenToggle = true,
  modelLabel = (model) => model,
  toolLabels,
  footer,
  icon,
}: SitepilotWidgetProps) {
  const pilot = usePilot();
  const { messages, status, error, enabledTools, send, stop, reset, setTools } = useSitepilot();
  const [open, setOpen] = useState(defaultOpen);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [seeing, setSeeing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labels = { ...TOOL_LABELS, ...toolLabels };
  const busy = status !== "idle";

  useEffect(ensureStyles, []);
  useEffect(() => (seeing && open ? pilot.showSeen() : undefined), [seeing, open, pilot]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the bottom whenever a message or the typing indicator appears
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, status]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send(text);
  };

  const actions = pilot.availableTools().filter((t) => t.kind === "action");
  const toggle = (name: string) =>
    setTools(enabledTools.includes(name) ? enabledTools.filter((t) => t !== name) : [...enabledTools, name]);
  const [welcomeHead = "", ...welcomeRest] = welcome.split("\n\n");

  return (
    <div className="sp-root" {...markPanel()}>
      {!open ? (
        <button type="button" className="sp-launch" aria-label={`Open ${title}`} onClick={() => setOpen(true)}>
          {icon ?? Icon.spark}
        </button>
      ) : (
        <div className={closing ? "sp-panel is-closing" : "sp-panel"} role="dialog" aria-label={title}>
          <div className="sp-head">
            <div className="sp-avatar">{icon ?? Icon.spark}</div>
            <div className="sp-titles">
              <div className="sp-title">{title}</div>
              {(busy || subtitle) && (
                <div className={busy ? "sp-sub is-busy" : "sp-sub"}>
                  <i aria-hidden="true" />
                  {status === "thinking" ? "Thinking…" : status === "acting" ? "Working on the page…" : subtitle}
                </div>
              )}
            </div>
            {showSeenToggle && (
              <button
                type="button"
                className={seeing ? "sp-icon is-on" : "sp-icon"}
                title="What the AI sees"
                aria-label="What the AI sees"
                aria-pressed={seeing}
                onClick={() => setSeeing(!seeing)}
              >
                {Icon.eye}
              </button>
            )}
            <button
              type="button"
              className="sp-icon"
              title="New conversation"
              aria-label="New conversation"
              onClick={reset}
            >
              {Icon.reset}
            </button>
            <button type="button" className="sp-icon" aria-label="Close" onClick={() => setClosing(true)}>
              {Icon.close}
            </button>
          </div>

          {showToolToggles && actions.length > 0 && (
            <fieldset className="sp-tools" aria-label="Allowed actions">
              {actions.map((t) => {
                const name = t.spec.function.name;
                const on = enabledTools.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={on ? "sp-chip is-on" : "sp-chip"}
                    aria-pressed={on}
                    onClick={() => toggle(name)}
                  >
                    {on && Icon.check}
                    {labels[name] ?? name}
                  </button>
                );
              })}
            </fieldset>
          )}

          <div className="sp-log" ref={logRef}>
            {messages.length === 0 && (
              <div className="sp-empty">
                {welcomeRest.length > 0 && <b>{welcomeHead}</b>}
                {welcomeRest.length > 0 ? welcomeRest.join("\n\n") : welcomeHead}
              </div>
            )}
            {messages.map((m) => (
              <Fragment key={m.id}>
                {m.role === "activity" ? (
                  <div className="sp-activity">
                    {Icon.bolt}
                    {m.content}
                  </div>
                ) : (
                  <div className={`sp-msg sp-${m.role}`}>
                    {m.role === "assistant" ? renderMarkdown(m.content) : <p>{m.content}</p>}
                  </div>
                )}
                {seeing && m.by && <div className="sp-by">{modelLabel(m.by)}</div>}
              </Fragment>
            ))}
            {busy && (
              <div className="sp-typing" role="status" aria-label={status === "thinking" ? "Thinking" : "Working"}>
                <span className="sp-dot" />
                <span className="sp-dot" />
                <span className="sp-dot" />
              </div>
            )}
            {error && <div className="sp-error">{error}</div>}
          </div>

          <form className="sp-form" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              className="sp-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              aria-label="Message"
            />
            {busy ? (
              <button type="button" className="sp-stop" onClick={stop}>
                Stop
              </button>
            ) : (
              <button type="submit" className="sp-send" disabled={!draft.trim()} aria-label="Send">
                {Icon.send}
              </button>
            )}
          </form>
          {footer && <div className="sp-footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}
