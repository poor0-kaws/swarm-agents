import { ArrowRight, MagnifyingGlass, Stack } from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import {
  createBatch,
  createRun,
  type BatchSummary,
  type CreateRunInput,
  type ResearchDepth,
  type ResearchRun,
} from "../api";
import { capitalize, messageFrom } from "../presentation";

export function ResearchComposer({
  onRunCreated,
  onBatchCreated,
}: {
  onRunCreated: (run: ResearchRun) => Promise<void>;
  onBatchCreated: (batch: BatchSummary) => Promise<void>;
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

  const submit = async (event: FormEvent) => {
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
      <FormHeading icon={<MagnifyingGlass size={20} />} title="Start research">
        One question becomes seven focused assignments.
      </FormHeading>
      <Field label="Industry" helper="Use a specific market or value chain.">
        <input value={industry} onChange={(event) => setIndustry(event.target.value)} required minLength={2} />
      </Field>
      <Field label="Research question" helper="Ask for a comparison, driver, risk, or market structure.">
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} required minLength={8} rows={4} />
      </Field>
      <DepthField value={depth} onChange={setDepth} />
      {error ? <p className="form-error">{error}</p> : null}
      <SubmitButton submitting={submitting} idleLabel="Run research" busyLabel="Adding to queue" />
    </form>
  );
}

function BatchForm({ onCreated }: { onCreated: (batch: BatchSummary) => Promise<void> }) {
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const batch = await createBatch({ name, items });
      await onCreated(batch);
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <FormHeading icon={<Stack size={20} />} title="Build a batch">
        Each line becomes a durable research run.
      </FormHeading>
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
      <SubmitButton
        submitting={submitting}
        disabled={items.length === 0}
        idleLabel="Queue batch"
        busyLabel="Adding batch"
      />
    </form>
  );
}

function FormHeading({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="form-heading">
      {icon}
      <div><h2>{title}</h2><p>{children}</p></div>
    </div>
  );
}

function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
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

function SubmitButton({
  submitting,
  disabled = false,
  idleLabel,
  busyLabel,
}: {
  submitting: boolean;
  disabled?: boolean;
  idleLabel: string;
  busyLabel: string;
}) {
  return (
    <button className="primary-button" type="submit" disabled={submitting || disabled}>
      <span>{submitting ? busyLabel : idleLabel}</span>
      <ArrowRight size={17} />
    </button>
  );
}
