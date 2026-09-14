import { computerPlugin } from "@sitepilot/computer";
import { openaiTransport } from "@sitepilot/core";
import { defineTool, mark, markContext, markItem, markRead, SitepilotProvider, SitepilotWidget } from "@sitepilot/react";
import { useState } from "react";

const transport = openaiTransport({ url: "/api/pilot" });
const plugins = [computerPlugin()];
const HISTORY_KEY = "acme-pilot-history";

function savedHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

interface Project {
  id: number;
  name: string;
  owner: string;
  status: "active" | "paused";
}

const seed: Project[] = [
  { id: 1, name: "Apollo", owner: "Ada", status: "active" },
  { id: 2, name: "Borealis", owner: "Grace", status: "paused" },
  { id: 3, name: "Cassini", owner: "Linus", status: "active" },
];

function CreateDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Create project"
        onClick={(e) => e.stopPropagation()}
        {...markContext("create-project", "A dialog for creating a new project. The user types a name and confirms.")}
      >
        <h2>New project</h2>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dione"
            {...mark("Project name field")}
          />
        </label>
        <div className="row">
          <button type="button" onClick={onClose} {...mark("Cancel button")}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim())}
            {...mark("Create project confirm button")}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [projects, setProjects] = useState(seed);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [tab, setTab] = useState<"projects" | "settings">("projects");

  const visible = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const countProjects = defineTool<{ status?: "active" | "paused" }>({
    name: "count_projects",
    description: "How many projects the user has, optionally filtered by status. Reads live app state, not the screen.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["active", "paused"] } } },
    kind: "utility",
    execute: ({ status }) => {
      const n = projects.filter((p) => !status || p.status === status).length;
      return `${n} project${n === 1 ? "" : "s"}${status ? ` are ${status}` : ""}.`;
    },
  });

  return (
    <SitepilotProvider
      transport={transport}
      plugins={plugins}
      tools={[countProjects]}
      prompt="server"
      user={{ id: "demo-user", name: "Jane", role: "owner" }}
      context={() => `The user is on the ${tab} tab and has ${projects.length} projects.`}
      history={{ initial: savedHistory(), onChange: (h) => localStorage.setItem(HISTORY_KEY, JSON.stringify(h)) }}
      strings={{ activity: { highlighted: (key) => `👉 ${key}` } }}
    >
      <div className="app" {...markContext("acme-projects", "Acme Projects: a workspace where the user manages projects.")}>
        <aside>
          <div className="brand">Acme</div>
          <nav>
            <button className={tab === "projects" ? "on" : ""} onClick={() => setTab("projects")} {...mark("Projects nav link")}>
              Projects
            </button>
            <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")} {...mark("Settings nav link")}>
              Settings
            </button>
          </nav>
        </aside>

        <main>
          {tab === "projects" ? (
            <>
              <header>
                <h1>Projects</h1>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects"
                  {...mark("Search projects field")}
                />
                <button className="primary" onClick={() => setCreating(true)} {...mark("Create project button")}>
                  + New project
                </button>
              </header>

              <ul className="cards">
                {visible.map((p) => (
                  <li key={p.id}>
                    <button className="card" onClick={() => setSelected(p)} {...markItem(`Project card: ${p.name}`)}>
                      <strong>{p.name}</strong>
                      <span>{p.owner}</span>
                      <em className={p.status}>{p.status}</em>
                    </button>
                  </li>
                ))}
                {visible.length === 0 && <li className="empty">No projects match “{query}”.</li>}
              </ul>

              {selected && (
                <section className="detail" {...markRead(`Details: ${selected.name}`)}>
                  <h2>{selected.name}</h2>
                  <p>Owner: {selected.owner}</p>
                  <p>Status: {selected.status}</p>
                  <button
                    onClick={() =>
                      setProjects((ps) =>
                        ps.map((p) => (p.id === selected.id ? { ...p, status: p.status === "active" ? "paused" : "active" } : p)),
                      )
                    }
                    {...mark(`Toggle status button (${selected.name})`)}
                  >
                    {selected.status === "active" ? "Pause" : "Resume"}
                  </button>
                  <button onClick={() => setSelected(null)} {...mark("Close details button")}>
                    Close
                  </button>
                </section>
              )}
            </>
          ) : (
            <section {...markContext("settings", "Account settings for the demo workspace.")}>
              <h1>Settings</h1>
              <label>
                Display name <input defaultValue="Jane" {...mark("Display name field")} />
              </label>
              <label>
                Email <input defaultValue="jane@example.com" {...mark("Email field")} />
              </label>
              <label>
                Password <input type="password" defaultValue="hunter2" {...mark("Password field")} />
              </label>
              <p className="muted">This card has no data-pilot attribute, so the agent cannot see it: secret plan 🐙</p>
            </section>
          )}
        </main>
      </div>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreate={(name) => {
            setProjects((ps) => [...ps, { id: Date.now(), name, owner: "You", status: "active" }]);
            setCreating(false);
          }}
        />
      )}

      <SitepilotWidget title="Pip" defaultOpen toolLabels={{ count_projects: "Count" }} />
    </SitepilotProvider>
  );
}
