import type { DemoActivityEvent } from "../../../demo/demoTypes";

interface ActivityTimelineProps {
  events: DemoActivityEvent[];
  emptyMessage?: string;
  maxItems?: number;
}

function roleBadgeClass(role: DemoActivityEvent["actorRole"]): string {
  switch (role) {
    case "Contractor":
      return "badge-qs";
    case "Client":
      return "badge-ok";
    case "AI Suggestion":
      return "badge-ai";
    default:
      return "badge-phase";
  }
}

export default function ActivityTimeline({
  events,
  emptyMessage = "No activity recorded yet.",
  maxItems,
}: ActivityTimelineProps) {
  const visible = maxItems ? events.slice(0, maxItems) : events;

  if (visible.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <ul className="saas-timeline">
      {visible.map((item) => (
        <li key={item.id} className="saas-timeline-item">
          <div className="saas-timeline-dot" aria-hidden="true" />
          <div className="saas-timeline-content">
            <div className="saas-timeline-head">
              <strong>{item.title}</strong>
              <span className={`badge ${roleBadgeClass(item.actorRole)}`}>
                {item.actorRole}
              </span>
            </div>
            <div className="saas-timeline-detail">{item.detail}</div>
            <div className="meta-line">
              {item.actor} · {item.timestamp} · Ref: <code>{item.entityId}</code>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
