import {
  ArrowClockwise,
  Brain,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getBatch,
  getQueueStats,
  getRun,
  listRuns,
  type BatchSummary,
  type QueueStats,
  type ResearchRun,
  type RunDetail,
} from "./api";
import { QueueOverview } from "./components/QueueOverview";
import { RecentRuns } from "./components/RecentRuns";
import { ResearchComposer } from "./components/ResearchComposer";
import { RunPanel } from "./components/RunPanel";
import { messageFrom, runNotice } from "./presentation";

const emptyQueue: QueueStats = {
  queued: 0,
  active: 0,
  retrying: 0,
  completed: 0,
  failed: 0,
  concurrency: 0,
};

export function App() {
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [queue, setQueue] = useState<QueueStats>(emptyQueue);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [activeBatch, setActiveBatch] = useState<BatchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (preferredRunId?: string) => {
    try {
      const [nextRuns, nextQueue] = await Promise.all([listRuns(), getQueueStats()]);
      const nextSelectedId = preferredRunId ?? selectedRunId ?? nextRuns[0]?.id ?? null;

      setRuns(nextRuns);
      setQueue(nextQueue);
      setSelectedRunId(nextSelectedId);
      setSelectedRun(nextSelectedId ? await getRun(nextSelectedId) : null);

      if (activeBatch && !isBatchFinished(activeBatch)) {
        setActiveBatch(await getBatch(activeBatch.id));
      }

      setError(null);
    } catch (refreshError) {
      setError(messageFrom(refreshError));
    } finally {
      setLoading(false);
    }
  }, [activeBatch?.id, activeBatch?.status, selectedRunId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workIsActive = useMemo(() => {
    const queueIsActive = queue.queued + queue.active + queue.retrying > 0;
    const batchIsActive = activeBatch ? !isBatchFinished(activeBatch) : false;
    return queueIsActive || batchIsActive;
  }, [activeBatch, queue]);

  useEffect(() => {
    if (!workIsActive) {
      return;
    }

    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, workIsActive]);

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    setSelectedRun(await getRun(runId));
  };

  const handleRunCreated = async (run: ResearchRun) => {
    setNotice(runNotice(run));
    setSelectedRunId(run.id);
    await refresh(run.id);
  };

  const handleBatchCreated = async (batch: BatchSummary) => {
    setActiveBatch(batch);
    setNotice(`${batch.total} historical research runs joined the queue.`);
    await refresh(batch.runIds[0]);
  };

  return (
    <div className="app-shell">
      <Topbar workerCount={queue.concurrency || 2} />
      <main className="page-wrap">
        <PageHeading onRefresh={() => void refresh()} />
        {notice ? <Notice message={notice} onDismiss={() => setNotice(null)} /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {activeBatch ? <BatchProgress batch={activeBatch} /> : null}
        <QueueOverview queue={queue} />

        <div className="workspace-grid">
          <aside className="control-column">
            <ResearchComposer onRunCreated={handleRunCreated} onBatchCreated={handleBatchCreated} />
            <RecentRuns
              runs={runs}
              selectedRunId={selectedRunId}
              loading={loading}
              onSelectRun={handleSelectRun}
            />
          </aside>
          <section className="detail-column" aria-live="polite">
            <RunPanel run={selectedRun} loading={loading} />
          </section>
        </div>
      </main>
    </div>
  );
}

function Topbar({ workerCount }: { workerCount: number }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Market Swarm home">
        <span className="brand-mark"><Brain size={19} weight="fill" /></span>
        <span>Market Swarm</span>
      </a>
      <div className="topbar-meta">
        <span className="provider-label">Research workspace</span>
        <span className="topbar-divider" aria-hidden="true" />
        <span>{workerCount} workers</span>
      </div>
    </header>
  );
}

function PageHeading({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">Industry intelligence</p>
        <h1>Research you can inspect.</h1>
        <p>Run focused agents, follow every handoff, and reuse work that is already complete.</p>
      </div>
      <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh dashboard">
        <ArrowClockwise size={18} />
      </button>
    </section>
  );
}

function Notice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="notice" role="status">
      <CheckCircle size={18} weight="fill" />
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      <WarningCircle size={18} weight="fill" />
      <span>{message}</span>
    </div>
  );
}

function BatchProgress({ batch }: { batch: BatchSummary }) {
  return (
    <section className="batch-progress" aria-label="Historical batch progress">
      <div><strong>{batch.name}</strong><span>{batch.status}</span></div>
      <dl>
        <div><dt>Total</dt><dd>{batch.total}</dd></div>
        <div><dt>Completed</dt><dd>{batch.completed}</dd></div>
        <div><dt>Failed</dt><dd>{batch.failed}</dd></div>
      </dl>
    </section>
  );
}

function isBatchFinished(batch: BatchSummary) {
  return batch.status === "completed" || batch.status === "failed";
}
