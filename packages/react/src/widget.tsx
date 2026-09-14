import { markPanel } from "@sitepilot/core";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePilot, useSitepilot } from "./provider";

const STYLE_ID = "sitepilot-widget-css";

const CSS = `
.sp-root{--sp-accent:var(--sitepilot-accent,#2563eb);--sp-bg:var(--sitepilot-bg,#fff);--sp-fg:var(--sitepilot-fg,#111827);--sp-muted:var(--sitepilot-muted,#6b7280);--sp-border:var(--sitepilot-border,#e5e7eb);--sp-radius:var(--sitepilot-radius,14px);position:fixed;right:20px;bottom:20px;z-index:10002;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--sp-fg)}
.sp-launch{width:52px;height:52px;border-radius:50%;border:0;background:var(--sp-accent);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.sp-panel{width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 48px));display:flex;flex-direction:column;background:var(--sp-bg);border:1px solid var(--sp-border);border-radius:var(--sp-radius);box-shadow:0 16px 48px rgba(0,0,0,.2);overflow:hidden}
.sp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--sp-border)}
.sp-head strong{flex:1}
.sp-icon{border:0;background:transparent;color:var(--sp-muted);cursor:pointer;font-size:16px;padding:4px 6px;border-radius:6px}
.sp-icon:hover{background:var(--sp-border)}
.sp-tools{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid var(--sp-border)}
.sp-tools label{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--sp-muted);cursor:pointer}
.sp-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.sp-msg{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
.sp-user{align-self:flex-end;background:var(--sp-accent);color:#fff;border-bottom-right-radius:4px}
.sp-assistant{align-self:flex-start;background:var(--sp-border);border-bottom-left-radius:4px}
.sp-activity{align-self:center;font-size:12px;color:var(--sp-muted)}
.sp-error{align-self:stretch;font-size:12px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:6px 10px;border-radius:8px}
.sp-status{font-size:12px;color:var(--sp-muted);padding:0 12px 6px}
.sp-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--sp-border)}
.sp-form input{flex:1;padding:9px 11px;border:1px solid var(--sp-border);border-radius:10px;font:inherit;color:inherit;background:transparent;outline:none}
.sp-form input:focus{border-color:var(--sp-accent)}
.sp-send{padding:0 14px;border:0;border-radius:10px;background:var(--sp-accent);color:#fff;font:inherit;cursor:pointer}
.sp-send:disabled{opacity:.5;cursor:default}
.sp-empty{color:var(--sp-muted);text-align:center;margin:auto;padding:0 20px}
.sp-footer{font-size:11px;color:var(--sp-muted);text-align:center;padding:0 12px 8px}
.sp-footer a{color:inherit}
`;

function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const TOOL_LABELS: Record<string, string> = {
  highlight_element: "Point",
  click_element: "Click",
  fill_field: "Type",
  computer: "Screenshot",
};

export interface SitepilotWidgetProps {
  title?: string;
  placeholder?: string;
  /** Text shown before the first message. */
  welcome?: string;
  defaultOpen?: boolean;
  /** Show the per-tool consent toggles. Default true. */
  showToolToggles?: boolean;
  /** Labels for the consent toggles, by tool name. Merged over the built-in labels. */
  toolLabels?: Record<string, string>;
  /** Rendered under the composer, e.g. a "Powered by" line. */
  footer?: ReactNode;
}

export function SitepilotWidget({
  title = "Assistant",
  placeholder = "Ask where something is, or what to do…",
  welcome = "Hi! Ask me where anything is on this page and I can point at it, or do it for you.",
  defaultOpen = false,
  showToolToggles = true,
  toolLabels,
  footer,
}: SitepilotWidgetProps) {
  const labels = { ...TOOL_LABELS, ...toolLabels };
  const pilot = usePilot();
  const { messages, status, error, enabledTools, send, stop, reset, setTools } = useSitepilot();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(ensureStyles, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, status]);

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

  return (
    <div className="sp-root" {...markPanel()}>
      {!open ? (
        <button type="button" className="sp-launch" aria-label={`Open ${title}`} onClick={() => setOpen(true)}>
          ✦
        </button>
      ) : (
        <div className="sp-panel" role="dialog" aria-label={title}>
          <div className="sp-head">
            <strong>{title}</strong>
            <button type="button" className="sp-icon" title="New conversation" onClick={reset}>
              ↺
            </button>
            <button type="button" className="sp-icon" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {showToolToggles && actions.length > 0 && (
            <div className="sp-tools">
              {actions.map((t) => {
                const name = t.spec.function.name;
                return (
                  <label key={name}>
                    <input type="checkbox" checked={enabledTools.includes(name)} onChange={() => toggle(name)} />
                    {labels[name] ?? name}
                  </label>
                );
              })}
            </div>
          )}
          <div className="sp-log" ref={logRef}>
            {messages.length === 0 && <div className="sp-empty">{welcome}</div>}
            {messages.map((m) => (
              <div key={m.id} className={`sp-msg sp-${m.role}`}>
                {m.content}
              </div>
            ))}
            {error && <div className="sp-error">{error}</div>}
          </div>
          {status !== "idle" && (
            <div className="sp-status">
              {status === "thinking" ? "Thinking…" : "Working on the page…"}{" "}
              <button type="button" className="sp-icon" onClick={stop}>
                stop
              </button>
            </div>
          )}
          <form className="sp-form" onSubmit={onSubmit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              aria-label="Message"
              autoFocus
            />
            <button type="submit" className="sp-send" disabled={!draft.trim()}>
              Send
            </button>
          </form>
          {footer && <div className="sp-footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}
