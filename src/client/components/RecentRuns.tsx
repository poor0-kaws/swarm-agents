import { Books } from "@phosphor-icons/react";

import type { ResearchRun, RunStatus } from "../api";
import { formatRelativeTime, statusLabel } from "../presentation";

export function RecentRuns({
  runs,
  selectedRunId,
  loading,
  onSelectRun,
}: {
  runs: ResearchRun[];
  selectedRunId: string | null;
  loading: boolean;
  onSelectRun: (runId: string) => Promise<void>;
}) {
  return (
    <section className="recent-runs">
      <div className="section-title-row">
        <h2>Recent runs</h2>
        <span>{runs.length}</span>
      </div>
      {loading ? <RunListSkeleton /> : null}
      {!loading && runs.length === 0 ? <EmptyHistory /> : null}
      <div className="run-list">
        {runs.map((run) => (
          <button
            className={selectedRunId === run.id ? "run-row selected" : "run-row"}
            type="button"
            key={run.id}
            onClick={() => void onSelectRun(run.id)}
          >
            <div className="run-row-main">
              <strong>{run.industry}</strong>
              <span>{run.question}</span>
            </div>
            <div className="run-row-meta">
              <StatusBadge status={run.status} reuseKind={run.reuseKind} />
              <time dateTime={run.createdAt}>{formatRelativeTime(run.createdAt)}</time>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function StatusBadge({
  status,
  reuseKind,
}: {
  status: RunStatus;
  reuseKind: ResearchRun["reuseKind"];
}) {
  return <span className={`status-badge ${status}`}>{statusLabel(status, reuseKind)}</span>;
}

function EmptyHistory() {
  return (
    <div className="empty-small">
      <Books size={22} />
      <p>Your research history will appear here.</p>
    </div>
  );
}

function RunListSkeleton() {
  return (
    <div className="skeleton-list" aria-label="Loading recent runs">
      <span />
      <span />
      <span />
    </div>
  );
}
