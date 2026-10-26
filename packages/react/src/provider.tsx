import { createPilot, type Pilot, type PilotOptions, type PilotState } from "@sitepilot/core";
import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";

const read = <T,>(v: T | (() => T) | undefined): T | undefined => (typeof v === "function" ? (v as () => T)() : v);

const PilotContext = createContext<Pilot | null>(null);

export interface SitepilotProviderProps extends PilotOptions {
  children?: ReactNode;
  /** Bring your own instance (e.g. created once at module scope) instead of the options above. */
  pilot?: Pilot;
}

export function SitepilotProvider({ children, pilot: given, ...options }: SitepilotProviderProps) {
  const latest = useRef(options);
  latest.current = options;
  const { transport, plugins, prompt, systemPrompt } = options;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pilot is a new conversation, so only identity-bearing inputs rebuild it; tools/user/context are read through the ref every round
  const pilot = useMemo(
    () =>
      given ??
      createPilot({
        ...options,
        tools: () => read(latest.current.tools),
        user: () => read(latest.current.user),
        context: () => read(latest.current.context),
      }),
    [given, transport, plugins, prompt, systemPrompt],
  );
  return <PilotContext.Provider value={pilot}>{children}</PilotContext.Provider>;
}

export function usePilot(): Pilot {
  const pilot = useContext(PilotContext);
  if (!pilot) throw new Error("usePilot must be used inside <SitepilotProvider>");
  return pilot;
}

export function usePilotState(): PilotState {
  const pilot = usePilot();
  return useSyncExternalStore(pilot.subscribe, pilot.getState, pilot.getState);
}

export function useSitepilot(): PilotState & Pick<Pilot, "send" | "stop" | "reset" | "setTools" | "clearHighlight" | "getHistory" | "loadHistory"> {
  const pilot = usePilot();
  const state = usePilotState();
  return {
    ...state,
    send: pilot.send,
    stop: pilot.stop,
    reset: pilot.reset,
    setTools: pilot.setTools,
    clearHighlight: pilot.clearHighlight,
    getHistory: pilot.getHistory,
    loadHistory: pilot.loadHistory,
  };
}
