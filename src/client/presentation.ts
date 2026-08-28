import type { ResearchRun, RunStatus } from "./api.js";

export function runNotice(run: ResearchRun) {
  if (run.reuseKind === "cached") {
    return "A fresh cached result was ready immediately.";
  }

  if (run.reuseKind === "deduplicated") {
    return "This request joined matching work already in progress.";
  }

  return "Research joined the queue.";
}

export function statusLabel(status: RunStatus, reuseKind: ResearchRun["reuseKind"]) {
  if (reuseKind === "cached") {
    return "Cached";
  }

  if (reuseKind === "deduplicated") {
    return status === "completed" ? "Joined result" : "Joined";
  }

  return capitalize(status);
}

export function statusTitle(status: RunStatus) {
  const titles: Record<RunStatus, string> = {
    queued: "Waiting for a worker",
    running: "Agents are researching",
    retrying: "Waiting to try again",
    completed: "Research complete",
    failed: "Research stopped",
  };

  return titles[status];
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function formatNumber(value: number) {
  const notation = value > 9_999 ? "compact" : "standard";
  return new Intl.NumberFormat("en-US", { notation }).format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string) {
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
