import { useMemo, useState } from "react";
import { DemoProvider, useDemo } from "./demo/DemoContext";
import { formatInr } from "./demo/demoSeed";
import type { ClientPageId, ContractorPageId } from "./demo/demoTypes";
import LiveEngineWorkspace from "./components/LiveEngineWorkspace";
import ContractorDashboard from "./components/demo/contractor/ContractorDashboard";
import ProjectWorkspace from "./components/demo/contractor/ProjectWorkspace";
import InstructionInbox from "./components/demo/contractor/InstructionInbox";
import AiChangeIntelligence from "./components/demo/contractor/AiChangeIntelligence";
import VariationWorkspace from "./components/demo/contractor/VariationWorkspace";
import ApprovalWorkflow from "./components/demo/contractor/ApprovalWorkflow";
import ProgressEvidence from "./components/demo/contractor/ProgressEvidence";
import DelayRiskView from "./components/demo/contractor/DelayRiskView";
import BillingTracking from "./components/demo/contractor/BillingTracking";
import ClientDashboard from "./components/demo/client/ClientDashboard";
import ClientVariationInbox from "./components/demo/client/ClientVariationInbox";
import ClientProgressView from "./components/demo/client/ClientProgressView";
import ClientDelayBillingView from "./components/demo/client/ClientDelayBillingView";

interface NavItem<T extends string> {
  id: T;
  label: string;
  shortTag?: string;
}

const CONTRACTOR_NAV: NavItem<ContractorPageId>[] = [
  { id: "dashboard", label: "Commercial Overview", shortTag: "Home" },
  { id: "project", label: "Project & Documents" },
  { id: "inbox", label: "Instruction Inbox" },
  { id: "ai_intelligence", label: "AI Change Intelligence", shortTag: "AI" },
  { id: "variation", label: "Cost & Variation Build-Up" },
  { id: "approval_workflow", label: "Approval & Client Notice" },
  { id: "progress", label: "Work Progress Evidence" },
  { id: "delays", label: "Delays & Risk Notices" },
  { id: "billing", label: "Billing & Payments" },
];

const CLIENT_NAV: NavItem<ClientPageId>[] = [
  { id: "client_dashboard", label: "Client Overview", shortTag: "Portal" },
  { id: "client_variations", label: "Variation Review Inbox" },
  { id: "client_progress", label: "Site Progress Evidence" },
  { id: "client_delays_billing", label: "Delays & Billing" },
];

interface SearchHit {
  id: string;
  kind: "Variation" | "Instruction" | "Delay" | "Invoice";
  title: string;
  subtitle: string;
  projectId: string;
  onSelect: () => void;
}

function AppShell() {
  const {
    state,
    setRole,
    setContractorPage,
    setClientPage,
    setSelectedProjectId,
    selectInstruction,
    openVariation,
    markNotificationRead,
    markAllNotificationsRead,
    resetDemo,
  } = useDemo();

  const [searchQuery, setSearchQuery] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [guidedExpanded, setGuidedExpanded] = useState(true);

  const activeProject =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];

  const isLiveEngine =
    (state.role === "contractor" && state.contractorPage === "live_engine") ||
    (state.role === "client" && state.clientPage === "live_engine");

  const roleNotifications = state.notifications.filter(
    (n) => n.targetRole === "both" || n.targetRole === state.role
  );
  const unreadCount = roleNotifications.filter((n) => !n.read).length;

  const badgeCountForContractorNav = (page: ContractorPageId): number | null => {
    const projVars = state.variations.filter((v) => v.projectId === activeProject.id);
    if (page === "inbox") {
      const pending = state.instructions.filter(
        (i) => i.projectId === activeProject.id && !i.qsConfirmed
      ).length;
      return pending > 0 ? pending : null;
    }
    if (page === "approval_workflow") {
      const n = projVars.filter((v) =>
        ["qs_review", "ready_for_contractor_approval", "contractor_approved"].includes(
          v.status
        )
      ).length;
      return n > 0 ? n : null;
    }
    if (page === "delays") {
      const n = state.delays.filter(
        (d) => d.projectId === activeProject.id && d.isOverdue
      ).length;
      return n > 0 ? n : null;
    }
    if (page === "billing") {
      const n = projVars.filter((v) => v.status === "executed").length;
      return n > 0 ? n : null;
    }
    return null;
  };

  const badgeCountForClientNav = (page: ClientPageId): number | null => {
    if (page === "client_variations") {
      const n = state.variations.filter(
        (v) =>
          v.projectId === activeProject.id &&
          (v.status === "submitted_to_client" || v.status === "clarification_requested")
      ).length;
      return n > 0 ? n : null;
    }
    if (page === "client_delays_billing") {
      const n = state.invoices.filter(
        (i) => i.projectId === activeProject.id && i.status !== "paid"
      ).length;
      return n > 0 ? n : null;
    }
    return null;
  };

  const searchHits = useMemo<SearchHit[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const hits: SearchHit[] = [];

    for (const v of state.variations) {
      if (
        v.id.toLowerCase().includes(q) ||
        v.title.toLowerCase().includes(q) ||
        v.floorLocation.toLowerCase().includes(q) ||
        v.trade.toLowerCase().includes(q)
      ) {
        hits.push({
          id: v.id,
          kind: "Variation",
          title: `${v.id}: ${v.title}`,
          subtitle: `${v.status.replace(/_/g, " ")} · ${formatInr(v.proposedAmount)}`,
          projectId: v.projectId,
          onSelect: () => {
            setSelectedProjectId(v.projectId);
            openVariation(v.id, state.role);
            setSearchQuery("");
          },
        });
      }
    }

    for (const ins of state.instructions) {
      if (
        ins.id.toLowerCase().includes(q) ||
        ins.subjectOrThread.toLowerCase().includes(q) ||
        ins.originalText.toLowerCase().includes(q) ||
        ins.senderName.toLowerCase().includes(q)
      ) {
        hits.push({
          id: ins.id,
          kind: "Instruction",
          title: `${ins.id}: ${ins.subjectOrThread}`,
          subtitle: `${ins.channel.replace(/_/g, " ")} · ${ins.senderName}`,
          projectId: ins.projectId,
          onSelect: () => {
            setSelectedProjectId(ins.projectId);
            setRole("contractor");
            selectInstruction(ins.id);
            setContractorPage("ai_intelligence");
            setSearchQuery("");
          },
        });
      }
    }

    for (const d of state.delays) {
      if (d.id.toLowerCase().includes(q) || d.title.toLowerCase().includes(q)) {
        hits.push({
          id: d.id,
          kind: "Delay",
          title: `${d.id}: ${d.title}`,
          subtitle: `${d.category} · Due ${d.dueDate}`,
          projectId: d.projectId,
          onSelect: () => {
            setSelectedProjectId(d.projectId);
            if (state.role === "client") {
              setClientPage("client_delays_billing");
            } else {
              setContractorPage("delays");
            }
            setSearchQuery("");
          },
        });
      }
    }

    for (const inv of state.invoices) {
      if (
        inv.id.toLowerCase().includes(q) ||
        inv.description.toLowerCase().includes(q) ||
        (inv.variationId ?? "").toLowerCase().includes(q)
      ) {
        hits.push({
          id: inv.id,
          kind: "Invoice",
          title: `${inv.id}: ${inv.milestoneName}`,
          subtitle: `${inv.status} · ${formatInr(inv.amount)}`,
          projectId: inv.projectId,
          onSelect: () => {
            setSelectedProjectId(inv.projectId);
            if (state.role === "client") {
              setClientPage("client_delays_billing");
            } else {
              setContractorPage("billing");
            }
            setSearchQuery("");
          },
        });
      }
    }

    return hits.slice(0, 8);
  }, [
    searchQuery,
    state.variations,
    state.instructions,
    state.delays,
    state.invoices,
    state.role,
    setSelectedProjectId,
    openVariation,
    setRole,
    selectInstruction,
    setContractorPage,
    setClientPage,
  ]);

  // Hero variation tracker for the 18-step guided panel walkthrough
  const heroVar = state.variations.find((v) => v.id === "VAR-SCT-004");
  const heroInst = state.instructions.find((i) => i.id === "INS-004");

  const walkthroughSteps = heroVar
    ? [
        {
          id: "step-inst",
          label: "1. Instruction",
          done: Boolean(heroInst?.aiAnalyzed),
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            setRole("contractor");
            if (heroInst) selectInstruction(heroInst.id);
            setContractorPage("inbox");
          },
        },
        {
          id: "step-ai",
          label: "2. AI & QS",
          done: Boolean(heroInst?.qsConfirmed),
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            setRole("contractor");
            if (heroInst) selectInstruction(heroInst.id);
            setContractorPage("ai_intelligence");
          },
        },
        {
          id: "step-cost",
          label: "3. Cost Build-Up",
          done: heroVar.costLines.every((l) => l.rate !== null && l.quantity !== null),
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            openVariation(heroVar.id, "contractor");
          },
        },
        {
          id: "step-dispatch",
          label: "4. Approve & Send",
          done: heroVar.contractorApproval.step === "dispatched_simulated",
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            openVariation(heroVar.id, "contractor");
            setContractorPage("approval_workflow");
          },
        },
        {
          id: "step-client",
          label: "5. Client Decision",
          done: [
            "client_approved",
            "partially_approved",
            "executed",
            "billed",
            "paid",
          ].includes(heroVar.status),
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            openVariation(heroVar.id, "client");
            setClientPage("client_variations");
          },
        },
        {
          id: "step-exec",
          label: "6. Execution",
          done: ["executed", "billed", "paid"].includes(heroVar.status),
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            setRole("contractor");
            setContractorPage("progress");
          },
        },
        {
          id: "step-bill",
          label: "7. Billing",
          done: ["billed", "paid"].includes(heroVar.status),
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            setRole("contractor");
            setContractorPage("billing");
          },
        },
        {
          id: "step-paid",
          label: "8. Settled",
          done: heroVar.status === "paid",
          onClick: () => {
            setSelectedProjectId("proj-skyline");
            setRole("client");
            setClientPage("client_delays_billing");
          },
        },
      ]
    : [];

  const renderMainContent = () => {
    if (isLiveEngine) {
      return <LiveEngineWorkspace />;
    }

    if (state.role === "client") {
      switch (state.clientPage) {
        case "client_dashboard":
          return <ClientDashboard />;
        case "client_variations":
          return <ClientVariationInbox />;
        case "client_progress":
          return <ClientProgressView />;
        case "client_delays_billing":
          return <ClientDelayBillingView />;
        default:
          return <ClientDashboard />;
      }
    }

    switch (state.contractorPage) {
      case "dashboard":
        return <ContractorDashboard />;
      case "project":
        return <ProjectWorkspace />;
      case "inbox":
        return <InstructionInbox />;
      case "ai_intelligence":
        return <AiChangeIntelligence />;
      case "variation":
        return <VariationWorkspace />;
      case "approval_workflow":
        return <ApprovalWorkflow />;
      case "progress":
        return <ProgressEvidence />;
      case "delays":
        return <DelayRiskView />;
      case "billing":
        return <BillingTracking />;
      default:
        return <ContractorDashboard />;
    }
  };

  return (
    <div className={`app-layout ${state.role === "client" ? "role-client" : "role-contractor"}`}>
      {/* Left Navigation Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">S2C</div>
          <div>
            <strong>Site-to-Cash</strong>
            <span>Commercial Change AI</span>
          </div>
        </div>

        <div className="sidebar-persona">
          <span className="persona-label">
            {state.role === "client" ? "Client Portal" : "Contractor Workspace"}
          </span>
          <strong>
            {state.role === "client"
              ? "Vikram Malhotra · Siddharth Rao"
              : "Rohan Deshmukh · Meera Nair"}
          </strong>
          <small>
            {state.role === "client" ? activeProject.client : activeProject.contractor}
          </small>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="sidebar-section-label">
            {state.role === "client" ? "Client Review Suite" : "Contractor Lifecycle"}
          </div>

          {state.role === "contractor"
            ? CONTRACTOR_NAV.map((item) => {
                const count = badgeCountForContractorNav(item.id);
                const active = state.contractorPage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`sidebar-link ${active ? "active" : ""}`}
                    onClick={() => setContractorPage(item.id)}
                  >
                    <span>{item.label}</span>
                    {count !== null && <span className="nav-count">{count}</span>}
                  </button>
                );
              })
            : CLIENT_NAV.map((item) => {
                const count = badgeCountForClientNav(item.id);
                const active = state.clientPage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`sidebar-link ${active ? "active" : ""}`}
                    onClick={() => setClientPage(item.id)}
                  >
                    <span>{item.label}</span>
                    {count !== null && <span className="nav-count">{count}</span>}
                  </button>
                );
              })}

          <div className="sidebar-section-label" style={{ marginTop: 18 }}>
            Real Phase 1–7 Engine
          </div>
          <button
            type="button"
            className={`sidebar-link ${isLiveEngine ? "active" : ""}`}
            onClick={() => {
              if (state.role === "client") {
                setClientPage("live_engine");
              } else {
                setContractorPage("live_engine");
              }
            }}
          >
            <span>Live Backend (Phases 1–7)</span>
            <span className="nav-count live">API</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <p className="muted-note" style={{ margin: 0, fontSize: "0.75rem", color: "#cbd5e1" }}>
            “Never let a site instruction become an undocumented, unapproved, or unbilled
            variation.”
          </p>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="main-column">
        {/* Enterprise Topbar */}
        <header className="topbar-bar">
          <div className="topbar-left">
            <select
              aria-label="Active demo project"
              className="status-select project-select"
              value={activeProject.id}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>

            <div className="search-wrap">
              <input
                type="search"
                aria-label="Search variations, instructions, delays, and invoices"
                className="search-input"
                placeholder="Search variations, delays, invoices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.trim() !== "" && (
                <div className="search-popover">
                  {searchHits.length === 0 ? (
                    <div className="muted-note" style={{ padding: 10 }}>
                      No matching variations, instructions, delays, or invoices.
                    </div>
                  ) : (
                    searchHits.map((hit) => (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        type="button"
                        className="search-hit"
                        onClick={hit.onSelect}
                      >
                        <div className="edit-row">
                          <span className="badge">{hit.kind}</span>
                          <strong>{hit.title}</strong>
                        </div>
                        <span className="muted-note">{hit.subtitle}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="topbar-right">
            {isLiveEngine ? (
              <span className="mode-pill live" title="Connected to live FastAPI backend">
                LIVE API
              </span>
            ) : (
              <span className="mode-pill demo" title="Demo Mode — Local browser simulation">
                DEMO MODE
              </span>
            )}

            <div className="role-switcher" role="group" aria-label="Switch perspective">
              <button
                type="button"
                className={`role-btn ${state.role === "contractor" ? "active" : ""}`}
                onClick={() => setRole("contractor")}
              >
                Contractor View
              </button>
              <button
                type="button"
                className={`role-btn ${state.role === "client" ? "active" : ""}`}
                onClick={() => setRole("client")}
              >
                Client View
              </button>
            </div>

            <div className="notif-wrap">
              <button
                type="button"
                className="btn-icon"
                aria-label="Open notifications"
                onClick={() => setNotifOpen((prev) => !prev)}
              >
                🔔 {unreadCount > 0 && <span className="notif-dot">{unreadCount}</span>}
              </button>

              {notifOpen && (
                <div className="notif-drawer">
                  <div className="saas-card-header" style={{ marginBottom: 8 }}>
                    <strong>Notifications ({unreadCount} unread)</strong>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => markAllNotificationsRead()}
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="notif-list">
                    {roleNotifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className={`notif-item ${n.read ? "read" : "unread"}`}
                        onClick={() => {
                          markNotificationRead(n.id);
                          setSelectedProjectId(n.projectId);
                          if (state.role === "client" && n.linkPageClient) {
                            if (n.entityId && n.entityId.startsWith("VAR-")) {
                              openVariation(n.entityId, "client");
                            } else {
                              setClientPage(n.linkPageClient);
                            }
                          } else if (n.linkPageContractor) {
                            if (n.entityId && n.entityId.startsWith("VAR-")) {
                              openVariation(n.entityId, "contractor");
                              setContractorPage(n.linkPageContractor);
                            } else if (n.entityId && n.entityId.startsWith("INS-")) {
                              selectInstruction(n.entityId);
                              setContractorPage(n.linkPageContractor);
                            } else {
                              setContractorPage(n.linkPageContractor);
                            }
                          }
                          setNotifOpen(false);
                        }}
                      >
                        <div className="edit-row">
                          <strong>{n.title}</strong>
                          {!n.read && <span className="badge badge-qs">New</span>}
                        </div>
                        <p>{n.message}</p>
                        <span className="muted-note">{n.timestamp}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn"
              title="Reset seeded Skyline Commercial Tower scenario"
              onClick={() => {
                resetDemo();
                setNotifOpen(false);
              }}
            >
              Reset Demo
            </button>
          </div>
        </header>

        {/* Guided Buildathon Scenario Bar (Tracks Hero Case VAR-SCT-004 Live) */}
        {!isLiveEngine && heroVar && (
          <div className="guided-bar">
            <div className="guided-bar-top">
              <div className="guided-bar-summary">
                <span className="badge badge-phase">Hero Scenario</span>
                <strong className="guided-title">VAR-SCT-004: 2F HVAC Duct Relocation</strong>
                <span className="guided-meta">
                  Status: <strong>{heroVar.status.replace(/_/g, " ")}</strong> · Proposed:{" "}
                  {formatInr(heroVar.proposedAmount)} · Approved:{" "}
                  {formatInr(heroVar.approvedAmount, "Pending")}
                </span>
              </div>
              <button
                type="button"
                className="btn guided-toggle"
                onClick={() => setGuidedExpanded((e) => !e)}
              >
                {guidedExpanded ? "Hide Steps" : "Show 8-Stage Walkthrough"}
              </button>
            </div>

            {guidedExpanded && (
              <div className="guided-steps">
                {walkthroughSteps.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    className={`guided-pill ${st.done ? "done" : ""}`}
                    onClick={st.onClick}
                  >
                    <span>{st.done ? "✓" : "○"}</span> {st.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active Workspace Canvas */}
        <main className="main-canvas">{renderMainContent()}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <DemoProvider>
      <AppShell />
    </DemoProvider>
  );
}
