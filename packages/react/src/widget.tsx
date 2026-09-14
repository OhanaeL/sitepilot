import { markPanel } from "@sitepilot/core";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { renderMarkdown } from "./markdown";
import { usePilot, useSitepilot } from "./provider";

const STYLE_ID = "sitepilot-widget-css";

const CSS = `
.sp-root{--sp-accent:var(--sitepilot-accent,#2563eb);--sp-on-accent:var(--sitepilot-on-accent,#fff);--sp-bg:var(--sitepilot-bg,#fff);--sp-fg:var(--sitepilot-fg,#111827);--sp-muted:var(--sitepilot-muted,#6b7280);--sp-border:var(--sitepilot-border,#e5e7eb);--sp-bubble:var(--sitepilot-bubble,#f3f4f6);--sp-radius:var(--sitepilot-radius,18px);--sp-font:var(--sitepilot-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);position:fixed;right:20px;bottom:20px;z-index:10002;font:14px/1.5 var(--sp-font);color:var(--sp-fg);-webkit-font-smoothing:antialiased}
.sp-root *{box-sizing:border-box}
.sp-launch{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;border:0;background:var(--sp-accent);color:var(--sp-on-accent);cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.22);transition:transform .15s ease,box-shadow .15s ease}
.sp-launch:hover{transform:translateY(-1px);box-shadow:0 14px 34px rgba(0,0,0,.26)}
.sp-launch svg{width:24px;height:24px}
.sp-panel{width:min(400px,calc(100vw - 32px));height:min(640px,calc(100vh - 48px));display:flex;flex-direction:column;background:var(--sp-bg);border:1px solid var(--sp-border);border-radius:var(--sp-radius);box-shadow:0 24px 64px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.08);overflow:hidden;animation:sp-in .18s ease-out}
@keyframes sp-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sp-panel{animation:none}.sp-dot{animation:none}}
.sp-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-bottom:1px solid var(--sp-border)}
.sp-avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--sp-accent);color:var(--sp-on-accent);flex:none}
.sp-avatar svg{width:18px;height:18px}
.sp-titles{flex:1;min-width:0;line-height:1.25}
.sp-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-sub{font-size:12px;color:var(--sp-muted);display:flex;align-items:center;gap:6px}
.sp-sub i{width:7px;height:7px;border-radius:50%;background:#22c55e;flex:none}
.sp-sub.is-busy i{background:var(--sp-accent);animation:sp-pulse 1s ease-in-out infinite}
@keyframes sp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.sp-icon{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--sp-muted);cursor:pointer;flex:none}
.sp-icon:hover{background:var(--sp-bubble);color:var(--sp-fg)}
.sp-icon svg{width:16px;height:16px}
.sp-tools{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px 0}
.sp-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;border:1px solid var(--sp-border);background:transparent;color:var(--sp-muted);font:inherit;font-size:12px;cursor:pointer;line-height:1.4}
.sp-chip.is-on{border-color:var(--sp-accent);color:var(--sp-accent);background:color-mix(in srgb,var(--sp-accent) 10%,transparent)}
.sp-chip svg{width:12px;height:12px}
.sp-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:var(--sp-border) transparent}
.sp-msg{max-width:84%;padding:9px 13px;border-radius:16px;word-break:break-word;font-size:14px}
.sp-msg p{margin:0}.sp-msg p+p,.sp-msg p+ul,.sp-msg p+ol,.sp-msg ul+p,.sp-msg ol+p{margin-top:6px}
.sp-msg ul,.sp-msg ol{margin:0;padding-left:18px}.sp-msg li+li{margin-top:2px}
.sp-msg code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;padding:1px 5px;border-radius:5px;background:rgba(127,127,127,.15)}
.sp-msg pre{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.12);overflow-x:auto}.sp-msg pre code{padding:0;background:none}
.sp-msg a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.sp-user{align-self:flex-end;background:var(--sp-accent);color:var(--sp-on-accent);border-bottom-right-radius:5px}
.sp-assistant{align-self:flex-start;background:var(--sp-bubble);border-bottom-left-radius:5px}
.sp-activity{align-self:flex-start;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--sp-muted);padding:0 4px;margin:-4px 0}
.sp-activity svg{width:13px;height:13px;flex:none;color:var(--sp-accent)}
.sp-typing{align-self:flex-start;display:flex;gap:4px;padding:11px 14px;border-radius:16px;border-bottom-left-radius:5px;background:var(--sp-bubble)}
.sp-dot{width:6px;height:6px;border-radius:50%;background:var(--sp-muted);animation:sp-bounce 1.2s infinite ease-in-out}
.sp-dot:nth-child(2){animation-delay:.15s}.sp-dot:nth-child(3){animation-delay:.3s}
@keyframes sp-bounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-4px);opacity:1}}
.sp-error{align-self:stretch;font-size:12.5px;color:#b91c1c;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.25);padding:8px 11px;border-radius:10px}
.sp-empty{margin:auto;padding:0 24px;text-align:center;color:var(--sp-muted);font-size:13.5px}
.sp-empty b{display:block;color:var(--sp-fg);font-size:15px;margin-bottom:6px}
.sp-stop{border:0;background:transparent;color:var(--sp-muted);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;padding:0 6px}
.sp-form{display:flex;align-items:center;gap:8px;padding:10px 12px 10px 14px;border-top:1px solid var(--sp-border)}
.sp-input{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--sp-border);border-radius:12px;font:inherit;color:inherit;background:transparent;outline:none;transition:border-color .12s}
.sp-input:focus{border-color:var(--sp-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--sp-accent) 18%,transparent)}
.sp-input::placeholder{color:var(--sp-muted)}
.sp-send{display:grid;place-items:center;width:38px;height:38px;border:0;border-radius:50%;background:var(--sp-accent);color:var(--sp-on-accent);cursor:pointer;flex:none;transition:opacity .12s,transform .12s}
.sp-send:disabled{opacity:.35;cursor:default}.sp-send:not(:disabled):hover{transform:scale(1.05)}
.sp-send svg{width:16px;height:16px}
.sp-footer{font-size:11px;color:var(--sp-muted);text-align:center;padding:0 14px 9px;line-height:1.4}
.sp-footer a{color:inherit;text-decoration:underline;text-underline-offset:2px}
`;

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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
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
  /** Small line under the title when idle. Default "Ready". */
  subtitle?: string;
  placeholder?: string;
  /** Shown before the first message; a blank line splits it into heading and body. */
  welcome?: string;
  defaultOpen?: boolean;
  /** Show the per-tool consent chips. Default true. */
  showToolToggles?: boolean;
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
  toolLabels,
  footer,
  icon,
}: SitepilotWidgetProps) {
  const pilot = usePilot();
  const { messages, status, error, enabledTools, send, stop, reset, setTools } = useSitepilot();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labels = { ...TOOL_LABELS, ...toolLabels };
  const busy = status !== "idle";

  useEffect(ensureStyles, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, status]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
        <div className="sp-panel" role="dialog" aria-label={title}>
          <div className="sp-head">
            <div className="sp-avatar">{icon ?? Icon.spark}</div>
            <div className="sp-titles">
              <div className="sp-title">{title}</div>
              <div className={busy ? "sp-sub is-busy" : "sp-sub"}>
                <i aria-hidden="true" />
                {status === "thinking" ? "Thinking…" : status === "acting" ? "Working on the page…" : subtitle}
              </div>
            </div>
            <button type="button" className="sp-icon" title="New conversation" aria-label="New conversation" onClick={reset}>
              {Icon.reset}
            </button>
            <button type="button" className="sp-icon" aria-label="Close" onClick={() => setOpen(false)}>
              {Icon.close}
            </button>
          </div>

          {showToolToggles && actions.length > 0 && (
            <div className="sp-tools" role="group" aria-label="Allowed actions">
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
            </div>
          )}

          <div className="sp-log" ref={logRef}>
            {messages.length === 0 && (
              <div className="sp-empty">
                {welcomeRest.length > 0 && <b>{welcomeHead}</b>}
                {welcomeRest.length > 0 ? welcomeRest.join("\n\n") : welcomeHead}
              </div>
            )}
            {messages.map((m) =>
              m.role === "activity" ? (
                <div key={m.id} className="sp-activity">
                  {Icon.bolt}
                  {m.content}
                </div>
              ) : (
                <div key={m.id} className={`sp-msg sp-${m.role}`}>
                  {m.role === "assistant" ? renderMarkdown(m.content) : <p>{m.content}</p>}
                </div>
              ),
            )}
            {busy && (
              <div className="sp-typing" aria-label={status === "thinking" ? "Thinking" : "Working"}>
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
