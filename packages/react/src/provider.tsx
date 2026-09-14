import { createPilot, type Pilot, type PilotOptions, type PilotState } from "@sitepilot/core";
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

const PilotContext = createContext<Pilot | null>(null);

export interface SitepilotProviderProps extends PilotOptions {
  children?: ReactNode;
  /** Bring your own instance (e.g. created once at module scope) instead of the options above. */
  pilot?: Pilot;
}

export function SitepilotProvider({ children, pilot: given, ...options }: SitepilotProviderProps) {
  const { transport, plugins, systemPrompt } = options;
  const pilot = useMemo(
    () => given ?? createPilot(options),
    // A new pilot means a new conversation; only the identity-bearing inputs should trigger that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [given, transport, plugins, systemPrompt],
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

export function useSitepilot(): PilotState & Pick<Pilot, "send" | "stop" | "reset" | "setTools" | "clearHighlight"> {
  const pilot = usePilot();
  const state = usePilotState();
  return {
    ...state,
    send: pilot.send,
    stop: pilot.stop,
    reset: pilot.reset,
    setTools: pilot.setTools,
    clearHighlight: pilot.clearHighlight,
  };
}
