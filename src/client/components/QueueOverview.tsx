import {
  ArrowClockwise,
  CheckCircle,
  Hourglass,
  Lightning,
  WarningCircle,
} from "@phosphor-icons/react";

import type { QueueStats } from "../api";

export function QueueOverview({ queue }: { queue: QueueStats }) {
  const metrics = [
    { label: "Queued", value: queue.queued, icon: Hourglass },
    { label: "Active", value: queue.active, icon: Lightning },
    { label: "Retrying", value: queue.retrying, icon: ArrowClockwise },
    { label: "Completed", value: queue.completed, icon: CheckCircle },
    { label: "Failed", value: queue.failed, icon: WarningCircle },
  ];

  return (
    <section className="queue-overview" aria-label="Queue overview">
      {metrics.map(({ label, value, icon: Icon }) => (
        <div className="queue-metric" key={label}>
          <Icon size={17} />
          <div>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        </div>
      ))}
      <div className="capacity-note">
        <span>Worker capacity</span>
        <strong>{queue.active} / {queue.concurrency || 2}</strong>
      </div>
    </section>
  );
}
