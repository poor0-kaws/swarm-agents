import {
  ArrowClockwise,
  ArrowRight,
  Books,
  Brain,
  CheckCircle,
  ClockCounterClockwise,
  Coins,
  Database,
  FileText,
  Hourglass,
  Lightning,
  MagnifyingGlass,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createBatch,
  createRun,
  getQueueStats,
  getRun,
  listRuns,
  type CreateRunInput,
  type QueueStats,
  type ResearchDepth,
  type ResearchRun,
  type RunDetail,
  type RunStatus,
} from "./api";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextRuns, nextQueue] = await Promise.all([listRuns(), getQueueStats()]);
      setRuns(nextRuns);
      setQueue(nextQueue);
      setError(null);

      const nextSelectedId = selectedRunId ?? nextRuns[0]?.id ?? null;
      setSelectedRunId(nextSelectedId);

      if (nextSelectedId) {
        setSelectedRun(await getRun(nextSelectedId));
      } else {
        setSelectedRun(null);
      }
    } catch (refreshError) {
      setError(messageFrom(refreshError));
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    setSelectedRun(await getRun(runId));
  };

  const handleRunCreated = async (run: ResearchRun) => {
    setNotice(run.reuseKind === "cached"
      ? "A fresh cached result was ready immediately."
      : run.reuseKind === "deduplicated"
        ? "This request joined matching work already in progress."
        : "Research joined the queue.");
    setSelectedRunId(run.id);
    await refresh();
  };

  const handleBatchCreated = async (count: number) => {
    setNotice(`${count} historical research runs joined the queue.`);
    await refresh();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Market Swarm home">
          <span className="brand-mark"><Brain size={19} weight="fill" /></span>
          <span>Market Swarm</span>
        </a>
        <div className="topbar-meta">
          <span className="provider-label">Research workspace</span>
          <span className="topbar-divider" aria-hidden="true" />
          <span>{queue.concurrency || 2} workers</span>
        </div>
      </header>

      <main className="page-wrap">
        <section className="page-heading">
          <div>
            <p className="eyebrow">Industry intelligence</p>
            <h1>Research you can inspect.</h1>
            <p>Run focused agents, follow every handoff, and reuse work that is already complete.</p>
          </div>
          <button className="icon-button" type="button" onClick={() => void refresh()} aria-label="Refresh dashboard">
            <ArrowClockwise size={18} />
          </button>
        </section>

        {notice ? (
          <div className="notice" role="status">
            <CheckCircle size={18} weight="fill" />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        ) : null}

        {error ? (
          <div className="error-banner" role="alert">
            <WarningCircle size={18} weight="fill" />
            <span>{error}</span>
          </div>
        ) : null}

        <QueueOverview queue={queue} />

        <div className="workspace-grid">
          <aside className="control-column">
            <ResearchComposer
              onRunCreated={handleRunCreated}
              onBatchCreated={handleBatchCreated}
            />
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

function QueueOverview({ queue }: { queue: QueueStats }) {
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

function ResearchComposer({
  onRunCreated,
  onBatchCreated,
}: {
  onRunCreated: (run: ResearchRun) => Promise<void>;
  onBatchCreated: (count: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<"single" | "batch">("single");

  return (
    <section className="composer surface">
      <div className="segmented-control" aria-label="Research type">
        <button className={mode === "single" ? "active" : ""} type="button" onClick={() => setMode("single")}>
          New run
        </button>
        <button className={mode === "batch" ? "active" : ""} type="button" onClick={() => setMode("batch")}>
          Historical batch
        </button>
      </div>
      {mode === "single"
        ? <SingleRunForm onCreated={onRunCreated} />
        : <BatchForm onCreated={onBatchCreated} />}
    </section>
  );
}

function SingleRunForm({ onCreated }: { onCreated: (run: ResearchRun) => Promise<void> }) {
  const [industry, setIndustry] = useState("Semiconductor equipment");
  const [question, setQuestion] = useState("Where is pricing power strongest across the value chain?");
  const [depth, setDepth] = useState<ResearchDepth>("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const run = await createRun({ industry, question, depth });
      await onCreated(run);
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-heading">
        <MagnifyingGlass size={20} />
        <div>
          <h2>Start research</h2>
          <p>One question becomes seven focused assignments.</p>
        </div>
      </div>
      <Field label="Industry" helper="Use a specific market or value chain.">
        <input value={industry} onChange={(event) => setIndustry(event.target.value)} required minLength={2} />
      </Field>
      <Field label="Research question" helper="Ask for a comparison, driver, risk, or market structure.">
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} required minLength={8} rows={4} />
      </Field>
      <DepthField value={depth} onChange={setDepth} />
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        <span>{submitting ? "Adding to queue" : "Run research"}</span>
        <ArrowRight size={17} />
      </button>
    </form>
  );
}

function BatchForm({ onCreated }: { onCreated: (count: number) => Promise<void> }) {
  const [name, setName] = useState("Five-year industry review");
  const [industry, setIndustry] = useState("Semiconductor equipment");
  const [questions, setQuestions] = useState("What changed in industry economics during 2024?\nWhat changed in industry economics during 2025?");
  const [depth, setDepth] = useState<ResearchDepth>("quick");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => questions
    .split("\n")
    .map((question) => question.trim())
    .filter(Boolean)
    .map<CreateRunInput>((question) => ({ industry, question, depth })), [depth, industry, questions]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await createBatch({ name, items });
      await onCreated(items.length);
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-heading">
        <Stack size={20} />
        <div>
          <h2>Build a batch</h2>
          <p>Each line becomes a durable research run.</p>
        </div>
      </div>
      <Field label="Batch name">
        <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
      </Field>
      <Field label="Industry">
        <input value={industry} onChange={(event) => setIndustry(event.target.value)} required minLength={2} />
      </Field>
      <Field label="Questions" helper={`${items.length} ${items.length === 1 ? "run" : "runs"}. Write one question per line.`}>
        <textarea value={questions} onChange={(event) => setQuestions(event.target.value)} required rows={5} />
      </Field>
      <DepthField value={depth} onChange={setDepth} />
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting || items.length === 0}>
        <span>{submitting ? "Adding batch" : "Queue batch"}</span>
        <ArrowRight size={17} />
      </button>
    </form>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {helper ? <span className="field-helper">{helper}</span> : null}
    </label>
  );
}

function DepthField({ value, onChange }: { value: ResearchDepth; onChange: (value: ResearchDepth) => void }) {
  return (
    <fieldset className="depth-field">
      <legend>Research depth</legend>
      <div className="depth-options">
        {(["quick", "standard", "deep"] as const).map((depth) => (
          <label key={depth}>
            <input type="radio" name="depth" value={depth} checked={value === depth} onChange={() => onChange(depth)} />
            <span>{capitalize(depth)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RecentRuns({
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
      {!loading && runs.length === 0 ? (
        <div className="empty-small">
          <Books size={22} />
          <p>Your research history will appear here.</p>
        </div>
      ) : null}
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

function RunPanel({ run, loading }: { run: RunDetail | null; loading: boolean }) {
  if (loading && !run) {
    return <DetailSkeleton />;
  }

  if (!run) {
    return (
      <div className="empty-detail surface">
        <FileText size={30} />
        <h2>No research selected</h2>
        <p>Start a run, then its evidence, usage, and queue history will appear here.</p>
      </div>
    );
  }

  return (
    <article className="run-detail surface">
      <header className="run-detail-header">
        <div>
          <div className="detail-meta">
            <StatusBadge status={run.status} reuseKind={run.reuseKind} />
            <span>{capitalize(run.depth)} depth</span>
            <span>{formatDate(run.createdAt)}</span>
          </div>
          <h2>{run.industry}</h2>
          <p>{run.question}</p>
        </div>
      </header>

      <UsageStrip run={run} />

      {run.status === "failed" ? (
        <div className="run-error">
          <WarningCircle size={20} weight="fill" />
          <div><strong>Research stopped</strong><p>{run.error}</p></div>
        </div>
      ) : null}

      {run.report ? <Report report={run.report} /> : <ActiveRun run={run} />}

      <RunTimeline run={run} />
    </article>
  );
}

function UsageStrip({ run }: { run: RunDetail }) {
  return (
    <section className="usage-strip" aria-label="Run usage">
      <div><Brain size={17} /><span>Agent calls</span><strong>{run.usage.requests}</strong></div>
      <div><Database size={17} /><span>Input tokens</span><strong>{formatNumber(run.usage.inputTokens)}</strong></div>
      <div><FileText size={17} /><span>Output tokens</span><strong>{formatNumber(run.usage.outputTokens)}</strong></div>
      <div><Coins size={17} /><span>Est. cost</span><strong>${run.usage.estimatedCostUsd.toFixed(4)}</strong></div>
    </section>
  );
}

function ActiveRun({ run }: { run: RunDetail }) {
  const completedAgents = run.usageRecords.length;

  return (
    <section className="active-run">
      <div className="active-icon"><Hourglass size={24} /></div>
      <h3>{statusTitle(run.status)}</h3>
      <p>{completedAgents} of 7 agents have completed their assignments.</p>
      <div className="agent-steps" aria-label="Agent progress">
        {[
          "Planner",
          "Filings",
          "Market",
          "News",
          "Risk",
          "Verifier",
          "Writer",
        ].map((agent, index) => (
          <span className={index < completedAgents ? "complete" : ""} key={agent}>
            {index < completedAgents ? <CheckCircle size={15} weight="fill" /> : <Hourglass size={15} />}
            {agent}
          </span>
        ))}
      </div>
    </section>
  );
}

function Report({ report }: { report: NonNullable<RunDetail["report"]> }) {
  return (
    <div className="report">
      <section className="summary-block">
        <h3>Executive summary</h3>
        <p>{report.executiveSummary}</p>
      </section>

      <section className="report-section">
        <div className="section-title-row"><h3>Key findings</h3><span>{report.findings.length}</span></div>
        <div className="findings-list">
          {report.findings.map((finding) => (
            <div className="finding" key={finding.title}>
              <div className="finding-heading">
                <strong>{finding.title}</strong>
                <span className={`confidence ${finding.confidence}`}>{finding.confidence}</span>
              </div>
              <p>{finding.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section">
        <h3>Material risks</h3>
        {report.risks.length > 0 ? (
          <ul className="risk-list">
            {report.risks.map((risk) => <li key={risk}><WarningCircle size={17} />{risk}</li>)}
          </ul>
        ) : <p className="muted-copy">No separate risk items were returned.</p>}
      </section>

      <section className="report-section">
        <div className="section-title-row"><h3>Sources</h3><span>{report.sources.length}</span></div>
        <div className="source-list">
          {report.sources.map((source) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
              <div><strong>{source.title}</strong><span>{source.sourceType} · {source.publishedAt}</span></div>
              <ArrowRight size={16} />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function RunTimeline({ run }: { run: RunDetail }) {
  return (
    <details className="timeline">
      <summary><ClockCounterClockwise size={17} />Run history<span>{run.events.length}</span></summary>
      <ol>
        {run.events.map((event) => (
          <li key={event.id}>
            <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
            <span>{event.message}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function StatusBadge({ status, reuseKind }: { status: RunStatus; reuseKind: ResearchRun["reuseKind"] }) {
  const label = reuseKind === "cached"
    ? "Cached"
    : reuseKind === "deduplicated" && status !== "completed"
      ? "Joined"
      : capitalize(status);

  return <span className={`status-badge ${status}`}>{label}</span>;
}

function RunListSkeleton() {
  return <div className="skeleton-list" aria-label="Loading recent runs"><span /><span /><span /></div>;
}

function DetailSkeleton() {
  return <div className="detail-skeleton surface" aria-label="Loading research detail"><span /><span /><span /><span /></div>;
}

function statusTitle(status: RunStatus) {
  const titles: Record<RunStatus, string> = {
    queued: "Waiting for a worker",
    running: "Agents are researching",
    retrying: "Waiting to try again",
    completed: "Research complete",
    failed: "Research stopped",
  };
  return titles[status];
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value > 9_999 ? "compact" : "standard" }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));

  if (minutes < 1) {
    return "Now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}
