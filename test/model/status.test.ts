import { describe, expect, it } from "vitest";

import { deriveStatus, errorKindFor, type StatusInput } from "../../src/model/status";
import type { AgentStatus, ErrorKind } from "../../src/model/types";
import {
  makeAssistant,
  makeError,
  makeIdle,
  makeSession,
  makeUser,
  type AssistantValues,
} from "../fixtures";

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
  readonly errorKind: ErrorKind | undefined;
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
    errorKind: undefined,
  },
  {
    name: "a pending permission waits for approval",
    input: statusInput({ permissions: 1, running: true }),
    status: "waiting",
    detail: "Waiting for permission",
    errorKind: undefined,
  },
  {
    name: "running wins over an idle message",
    input: statusInput({ running: true, messages: [makeIdle("failed")] }),
    status: "running",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "a retry before completion is a running detail",
    input: statusInput({
      running: true,
      ...withAssistant({ retry: { attempt: 3, at: 0, error: assistantError } }),
    }),
    status: "running",
    detail: "Retrying (attempt 3)",
    errorKind: undefined,
  },
  {
    name: "a completed assistant is not retrying",
    input: statusInput({
      running: true,
      ...withAssistant({ completed: 5, retry: { attempt: 3, at: 0, error: assistantError } }),
    }),
    status: "running",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "info outcome succeeded is done",
    input: statusInput({ info: makeSession({ outcome: "succeeded" }) }),
    status: "done",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "info outcome failed uses the assistant error category",
    input: statusInput({
      info: makeSession({ outcome: "failed", idle: 20 }),
      messages: [makeAssistant({ created: 10, error: makeError("secret", "ProviderAuthError") })],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "authentication",
  },
  {
    name: "info outcome interrupted is unknown with a detail",
    input: statusInput({ info: makeSession({ outcome: "interrupted" }) }),
    status: "unknown",
    detail: "Interrupted",
    errorKind: undefined,
  },
  {
    name: "the newest idle after a stale info outcome wins",
    input: statusInput({
      info: makeSession({ outcome: "interrupted", idle: 100 }),
      messages: [makeUser(200), makeIdle("succeeded", undefined, 220)],
    }),
    status: "done",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "a stale failed info does not fail a succeeded rerun",
    input: statusInput({
      info: makeSession({ outcome: "failed", idle: 100 }),
      messages: [makeUser(200), makeIdle("succeeded", undefined, 220)],
    }),
    status: "done",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "the newer terminal timestamp wins over an older idle message",
    input: statusInput({
      info: makeSession({ outcome: "interrupted", idle: 300 }),
      messages: [makeIdle("failed", undefined, 200)],
    }),
    status: "unknown",
    detail: "Interrupted",
    errorKind: undefined,
  },
  {
    name: "an info outcome older than the latest assistant start is ignored",
    input: statusInput({
      info: makeSession({ outcome: "failed", idle: 100 }),
      messages: [makeAssistant({ created: 200 })],
    }),
    status: "unknown",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "a queued user after a failed assistant still fails",
    input: statusInput({
      messages: [
        makeAssistant({ created: 10, error: makeError("secret", "ProviderAuthError") }),
        makeUser(20),
      ],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "authentication",
  },
  {
    name: "an assistant-only error yields failed",
    input: statusInput({
      messages: [makeAssistant({ created: 10, error: makeError("secret", "APIError") })],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "provider error",
  },
  {
    name: "a failed rerun after a success with stale info reports failed",
    input: statusInput({
      info: makeSession({ outcome: "succeeded", idle: 130 }),
      messages: [
        makeUser(100),
        makeAssistant({ created: 110, completed: 120 }),
        makeIdle("succeeded", undefined, 130),
        makeUser(200),
        makeAssistant({
          created: 210,
          error: makeError("secret", "ProviderRequestError"),
        }),
        makeIdle("failed", undefined, 220),
      ],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "provider error",
  },
  {
    name: "no outcome is unknown",
    input: statusInput(),
    status: "unknown",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "an idle message succeeds when info has no outcome",
    input: statusInput({ messages: [makeIdle("succeeded")] }),
    status: "done",
    detail: undefined,
    errorKind: undefined,
  },
  {
    name: "an idle message failure reports its own error category first",
    input: statusInput({
      messages: [
        makeAssistant({ created: 0, error: makeError("secret", "ProviderAuthError") }),
        makeIdle("failed", makeError("secret2", "ProviderRequestError"), 10),
      ],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "provider error",
  },
  {
    name: "an idle message failure falls back to the latest execution's error",
    input: statusInput({
      messages: [
        makeUser(0),
        makeAssistant({ created: 5, error: makeError("secret", "ContextOverflowError") }),
        makeIdle("failed", undefined, 10),
      ],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "context limit",
  },
  {
    name: "a queued user does not suppress the assistant error",
    input: statusInput({
      messages: [
        makeUser(100),
        makeAssistant({ created: 110, error: makeError("secret", "ProviderAuthError") }),
        makeUser(200),
        makeIdle("failed", undefined, 220),
      ],
    }),
    status: "failed",
    detail: undefined,
    errorKind: "authentication",
  },
];

describe("deriveStatus", () => {
  it.each(cases)("$name", ({ input, status, detail, errorKind }) => {
    expect(deriveStatus(input)).toStrictEqual({ status, detail, errorKind });
  });
});

const errorCases: readonly (readonly [string, string, number | undefined, ErrorKind])[] = [
  ["aborted", "MessageAbortedError", undefined, "aborted"],
  ["authentication", "ProviderAuthError", undefined, "authentication"],
  ["an auth status", "HTTPError", 401, "authentication"],
  ["context overflow", "ContextOverflowError", undefined, "context limit"],
  ["output length", "MessageOutputLengthError", undefined, "output limit"],
  ["rate limit", "ProviderRateLimitError", undefined, "rate limit"],
  ["a rate-limit status", "HTTPError", 429, "rate limit"],
  ["a provider error", "APIError", undefined, "provider error"],
  ["an unknown error", "UnknownError", undefined, "error"],
];

describe("errorKindFor", () => {
  it.each(errorCases)("maps %s", (_name, type, status, expected) => {
    expect(errorKindFor(makeError("secret", type, status))).toBe(expected);
  });
});
