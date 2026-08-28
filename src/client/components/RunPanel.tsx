import {
  ArrowRight,
  Brain,
  CheckCircle,
  ClockCounterClockwise,
  Coins,
  Database,
  FileText,
  Hourglass,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { RunDetail } from "../api";
import {
  capitalize,
  formatDate,
  formatNumber,
  formatTime,
  statusTitle,
} from "../presentation";
import { StatusBadge } from "./RecentRuns";

export function RunPanel({ run, loading }: { run: RunDetail | null; loading: boolean }) {
  if (loading && !run) {
    return <DetailSkeleton />;
  }

  if (!run) {
    return <EmptyDashboard />;
  }

  return (
    <article className="run-detail surface">
      <RunHeader run={run} />
      <UsageStrip run={run} />
      {run.status === "failed" ? <RunError message={run.error} /> : null}
      {run.report ? <Report report={run.report} /> : <ActiveRun run={run} />}
      <RunTimeline run={run} />
    </article>
  );
}

function RunHeader({ run }: { run: RunDetail }) {
  return (
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
  );
}

function UsageStrip({ run }: { run: RunDetail }) {
  return (
    <section className="usage-strip" aria-label="Run usage">
      <UsageMetric icon={<Brain size={17} />} label="Agent calls" value={String(run.usage.requests)} />
      <UsageMetric icon={<Database size={17} />} label="Input tokens" value={formatNumber(run.usage.inputTokens)} />
      <UsageMetric icon={<FileText size={17} />} label="Output tokens" value={formatNumber(run.usage.outputTokens)} />
      <UsageMetric icon={<Coins size={17} />} label="Est. cost" value={`$${run.usage.estimatedCostUsd.toFixed(4)}`} />
    </section>
  );
}

function UsageMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div>{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function RunError({ message }: { message: string | null }) {
  return (
    <div className="run-error">
      <WarningCircle size={20} weight="fill" />
      <div><strong>Research stopped</strong><p>{message}</p></div>
    </div>
  );
}

function ActiveRun({ run }: { run: RunDetail }) {
  const completedAgents = new Set(run.usageRecords.map((record) => record.agentName));
  const currentAgent = run.currentAgent
    ? run.agents.find((agent) => agent.name === run.currentAgent)
    : null;

  return (
    <section className="active-run">
      <div className="active-icon"><Hourglass size={24} /></div>
      <h3>{currentAgent ? readableAgentName(currentAgent.name) : statusTitle(run.status)}</h3>
      <p>{currentAgent?.purpose ?? `${completedAgents.size} of ${run.agents.length} agents have completed their assignments.`}</p>
      <div className="agent-steps" aria-label="Agent progress">
        {run.agents.map((agent) => {
          const complete = completedAgents.has(agent.name);
          const active = agent.name === run.currentAgent;
          const className = agentStepClassName(active, complete);

          return (
            <span className={className} key={agent.name}>
              {complete ? <CheckCircle size={15} weight="fill" /> : <Hourglass size={15} />}
              {readableAgentName(agent.name)}
            </span>
          );
        })}
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
        <Risks risks={report.risks} />
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

function RiskList({ risks }: { risks: string[] }) {
  return (
    <ul className="risk-list">
      {risks.map((risk) => <li key={risk}><WarningCircle size={17} />{risk}</li>)}
    </ul>
  );
}

function Risks({ risks }: { risks: string[] }) {
  if (risks.length === 0) {
    return <p className="muted-copy">No separate risk items were returned.</p>;
  }

  return <RiskList risks={risks} />;
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

function EmptyDashboard() {
  return (
    <div className="empty-detail surface">
      <Stack size={30} />
      <h2>A focused swarm, one inspected report</h2>
      <p>Start with the sample question. The planner scopes it, researchers gather evidence, a verifier checks it, and the writer creates the report.</p>
      <div className="empty-agent-flow" aria-label="Example research flow">
        <span>Plan</span><span>Research</span><span>Verify</span><span>Write</span>
      </div>
      <div className="example-report" aria-label="Example report structure">
        <strong>Example report</strong>
        <span>Executive summary</span>
        <span>Evidence-backed findings</span>
        <span>Risks and sources</span>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="detail-skeleton surface" aria-label="Loading research detail">
      <span /><span /><span /><span />
    </div>
  );
}

function readableAgentName(name: string) {
  return name
    .split("-")
    .map(capitalize)
    .join(" ");
}

function agentStepClassName(active: boolean, complete: boolean) {
  if (active) {
    return "active";
  }

  if (complete) {
    return "complete";
  }

  return "";
}
