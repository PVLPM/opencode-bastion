import { describe, expect, it } from "vitest";

import type { AgentStatus } from "../../src/model/types";
import { deriveStatus, type StatusInput } from "../../src/model/status";
import { makeAssistant, makeError, makeIdle, makeSession, type AssistantValues } from "../fixtures";

function statusInput(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    running: false,
    permissions: 0,
    forms: 0,
    info: makeSession(),
    messages: [],
    ...overrides,
  };
}

interface StatusCase {
  readonly name: string;
  readonly input: StatusInput;
  readonly status: AgentStatus;
  readonly detail: string | undefined;
  readonly error: string | undefined;
}

const assistantError = makeError("provider exploded");

function withAssistant(values: AssistantValues): Partial<StatusInput> {
  return { messages: [makeAssistant(values)] };
}

const cases: readonly StatusCase[] = [
  {
    name: "a pending form waits for the user before anything else",
    input: statusInput({ forms: 1, permissions: 1, running: true }),
    status: "waiting",
    detail: "Waiting for your answer",
    error: undefined,
  },
  {
    name: "a pending permission waits for approval",
    input: statusInput({ permissions: 1, running: true }),
    status: "waiting",
    detail: "Waiting for permission",
    error: undefined,
  },
  {
    name: "running wins over an idle message",
    input: statusInput({ running: true, messages: [makeIdle("failed")] }),
    status: "running",
    detail: undefined,
    error: undefined,
  },
  {
    name: "a retry before completion is a running detail",
    input: statusInput({
      running: true,
      ...withAssistant({ retry: { attempt: 3, at: 0, error: assistantError } }),
    }),
    status: "running",
    detail: "Retrying (attempt 3)",
    error: undefined,
  },
  {
    name: "a completed assistant is not retrying",
    input: statusInput({
      running: true,
      ...withAssistant({ completed: 5, retry: { attempt: 3, at: 0, error: assistantError } }),
    }),
    status: "running",
    detail: undefined,
    error: undefined,
  },
  {
    name: "info outcome succeeded is done",
    input: statusInput({ info: makeSession({ outcome: "succeeded" }) }),
    status: "done",
    detail: undefined,
    error: undefined,
  },
  {
    name: "info outcome failed uses the assistant error",
    input: statusInput({
      info: makeSession({ outcome: "failed" }),
      ...withAssistant({ error: assistantError }),
    }),
    status: "failed",
    detail: undefined,
    error: "provider exploded",
  },
  {
    name: "info outcome interrupted is unknown with a detail",
    input: statusInput({ info: makeSession({ outcome: "interrupted" }) }),
    status: "unknown",
    detail: "Interrupted",
    error: undefined,
  },
  {
    name: "info outcome wins over an idle message outcome",
    input: statusInput({
      info: makeSession({ outcome: "interrupted" }),
      messages: [makeIdle("succeeded")],
    }),
    status: "unknown",
    detail: "Interrupted",
    error: undefined,
  },
  {
    name: "no outcome is unknown",
    input: statusInput(),
    status: "unknown",
    detail: undefined,
    error: undefined,
  },
  {
    name: "an idle message succeeds when info has no outcome",
    input: statusInput({ messages: [makeIdle("succeeded")] }),
    status: "done",
    detail: undefined,
    error: undefined,
  },
  {
    name: "an idle message failure reports its own error first",
    input: statusInput({
      messages: [
        makeAssistant({ error: assistantError }),
        makeIdle("failed", makeError("idle failed")),
      ],
    }),
    status: "failed",
    detail: undefined,
    error: "idle failed",
  },
  {
    name: "an idle message failure falls back to the assistant error",
    input: statusInput({
      messages: [makeAssistant({ error: assistantError }), makeIdle("failed")],
    }),
    status: "failed",
    detail: undefined,
    error: "provider exploded",
  },
];

describe("deriveStatus", () => {
  it.each(cases)("$name", ({ input, status, detail, error }) => {
    expect(deriveStatus(input)).toStrictEqual({ status, detail, error });
  });
});
