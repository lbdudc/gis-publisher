import test from "node:test";
import assert from "node:assert/strict";

import { createReporter, PROTOCOL_PREFIX } from "../src/progress.js";

const capture = (mode) => {
  const lines = [];
  return { lines, reporter: createReporter(mode, (l) => lines.push(l)) };
};

const events = (lines) =>
  lines
    .filter((l) => l.startsWith(PROTOCOL_PREFIX))
    .map((l) => JSON.parse(l.slice(PROTOCOL_PREFIX.length)));

const PLAN = [
  { id: "read", label: "Read geographic data" },
  { id: "generate", label: "Generate application" },
  { id: "docker", label: "Check Docker" },
];

test("json mode: plan and steps carry their position in the plan", async () => {
  const { lines, reporter } = capture("json");
  reporter.plan(PLAN);
  await reporter.runStep("read", "Read geographic data", async () => {});

  const [plan, running, done] = events(lines);
  assert.deepEqual(plan, { event: "plan", steps: PLAN });
  assert.equal(running.status, "running");
  assert.equal(running.index, 1);
  assert.equal(running.total, 3);
  assert.equal(done.status, "done");
  assert.equal(typeof done.durationMs, "number");
});

test("json mode: a failing step is reported and tagged on the error", async () => {
  const { lines, reporter } = capture("json");
  reporter.plan(PLAN);
  const error = await reporter
    .runStep("generate", "Generate application", async () => {
      throw new Error("boom");
    })
    .catch((e) => e);

  assert.equal(error.message, "boom");
  assert.equal(error.step, "generate");
  const failed = events(lines).at(-1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.detail, "boom");

  reporter.error(error);
  const reported = events(lines).at(-1);
  assert.equal(reported.event, "error");
  assert.equal(reported.step, "generate");
  assert.equal(reported.message, "boom");
});

test("json mode: uploader events are forwarded on the same plan", () => {
  const { lines, reporter } = capture("json");
  reporter.plan(PLAN);
  reporter.forward({
    type: "step",
    id: "docker",
    label: "Check Docker",
    status: "done",
    durationMs: 12,
    index: 1,
    total: 4,
  });
  reporter.forward({ type: "log", step: "docker", line: "hello" });
  reporter.forward({
    type: "services",
    services: [
      {
        name: "web",
        state: "running",
        health: "healthy",
        status: "ready",
        exitCode: 0,
        container: "x",
      },
    ],
  });
  reporter.result({ url: "http://localhost", outputDir: "/o" });

  const [, step, log, services, result] = events(lines); // [0] is the plan
  // position comes from the announced plan, not from the uploader's own numbering
  assert.equal(step.index, 3);
  assert.equal(step.total, 3);
  assert.equal(log.line, "hello");
  assert.deepEqual(services.services, [
    { name: "web", state: "running", health: "healthy", status: "ready" },
  ]);
  assert.deepEqual(result, {
    event: "result",
    url: "http://localhost",
    outputDir: "/o",
  });
});

test("text mode prints readable lines and no protocol", async () => {
  const { lines, reporter } = capture("text");
  reporter.plan(PLAN);
  await reporter.runStep("read", "Read geographic data", async () => {});
  reporter.forward({
    type: "step",
    id: "docker",
    label: "Check Docker",
    status: "skipped",
    detail: "nothing to do",
  });
  reporter.forward({ type: "log", step: "docker", line: "output line" });
  reporter.result({ url: "http://localhost:80" });

  assert.equal(events(lines).length, 0);
  assert.match(lines[0], /^\[1\/3\] Read geographic data\.\.\.$/);
  assert.match(lines[1], /^\[1\/3\] Read geographic data - done \(\d+s\)$/);
  assert.equal(lines[2], "[3/3] Check Docker - skipped (nothing to do)");
  assert.equal(lines[3], "    output line");
  assert.equal(lines[4], "Application available at http://localhost:80");
});

test("text mode does not repeat an unchanged services line", () => {
  const { lines, reporter } = capture("text");
  const services = [
    { name: "a", status: "ready" },
    { name: "b", status: "pending" },
  ];
  reporter.forward({ type: "services", services });
  reporter.forward({ type: "services", services });
  reporter.forward({
    type: "services",
    services: services.map((s) => ({ ...s, status: "ready" })),
  });
  assert.deepEqual(lines, [
    "    services: 1/2 ready",
    "    services: 2/2 ready",
  ]);
});

test("a generate-only run reports where the app was written", () => {
  const { lines, reporter } = capture("text");
  reporter.result({ outputDir: "/tmp/out" });
  assert.equal(lines[0], "Application generated in /tmp/out");
});
