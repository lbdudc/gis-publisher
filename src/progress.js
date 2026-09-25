/**
 * Progress reporting for the CLI.
 *
 * Two modes:
 *  - "text" (default): readable lines for a person running gispublisher.
 *  - "json": one line per event on stdout, prefixed with PROTOCOL_PREFIX, for
 *    programs (the QGIS plugin) that show their own UI. Anything else the CLI
 *    prints is ignored by such a reader, so ordinary logging keeps working.
 *
 * Events (json mode, after the prefix):
 *   {"event":"plan","steps":[{"id","label"}]}
 *   {"event":"step","id","label","status":"running|done|failed|skipped",
 *    "index","total","durationMs","detail"}
 *   {"event":"services","services":[{"name","state","health","status"}]}
 *   {"event":"log","step","line"}
 *   {"event":"result","url","outputDir","editUser"?,"editPassword"?}
 *   {"event":"error","step","message","detail"}
 */

export const PROTOCOL_PREFIX = "@@gp ";

const formatDuration = (ms) => {
  const total = Math.round(ms / 1000);
  return total < 60
    ? `${total}s`
    : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};

export function createReporter(
  mode = "text",
  write = (line) => console.log(line)
) {
  const json = mode === "json";
  let steps = [];
  let lastServicesLine = "";

  const emit = (event) => write(PROTOCOL_PREFIX + JSON.stringify(event));

  const position = (id) => {
    const i = steps.findIndex((s) => s.id === id);
    return { index: i + 1, total: steps.length };
  };

  const stepEvent = (id, label, status, extra = {}) => {
    const { index, total } = position(id);
    if (json) {
      emit({ event: "step", id, label, status, index, total, ...extra });
      return;
    }
    const prefix = `[${index}/${total}] ${label}`;
    if (status === "running") write(`${prefix}...`);
    else if (status === "skipped") {
      write(`${prefix} - skipped${extra.detail ? ` (${extra.detail})` : ""}`);
    } else if (status === "failed") {
      write(`${prefix} - FAILED (${formatDuration(extra.durationMs)})`);
    } else write(`${prefix} - done (${formatDuration(extra.durationMs)})`);
  };

  return {
    mode,

    /** Announces every step up front, so a UI can list them as pending. */
    plan(list) {
      steps = list.map(({ id, label }) => ({ id, label }));
      if (json) emit({ event: "plan", steps });
    },

    /** Runs `fn` as the step `id` of the plan, reporting its outcome. */
    async runStep(id, label, fn) {
      const started = Date.now();
      stepEvent(id, label, "running");
      try {
        const value = await fn();
        stepEvent(id, label, "done", { durationMs: Date.now() - started });
        return value;
      } catch (error) {
        stepEvent(id, label, "failed", {
          durationMs: Date.now() - started,
          detail: error.message,
        });
        error.step = error.step || id;
        throw error;
      }
    },

    /** Forwards an event from the code uploader (its steps are part of the plan). */
    forward(event) {
      if (event.type === "step") {
        stepEvent(event.id, event.label, event.status, {
          durationMs: event.durationMs,
          detail: event.detail,
        });
      } else if (event.type === "log") {
        if (json) emit({ event: "log", step: event.step, line: event.line });
        else write(`    ${event.line}`);
      } else if (event.type === "services") {
        if (json) {
          emit({
            event: "services",
            services: event.services.map(({ name, state, health, status }) => ({
              name,
              state,
              health,
              status,
            })),
          });
        } else {
          const ready = event.services.filter(
            (s) => s.status === "ready"
          ).length;
          const line = `    services: ${ready}/${event.services.length} ready`;
          if (line !== lastServicesLine) write(line);
          lastServicesLine = line;
        }
      }
    },

    log(line) {
      if (json) emit({ event: "log", line });
      else write(line);
    },

    result({ url, outputDir, editAccount }) {
      if (json) {
        emit({
          event: "result",
          url,
          outputDir,
          ...(editAccount
            ? { editUser: editAccount.user, editPassword: editAccount.password }
            : {}),
        });
      } else {
        if (url) write(`Application available at ${url}`);
        else if (outputDir) write(`Application generated in ${outputDir}`);
        if (editAccount) {
          write(
            `Editing account: user "${editAccount.user}", password "${editAccount.password}"`
          );
        }
      }
    },

    /** Reports the failure of the whole run. */
    error(error) {
      const detail = String(error?.stack || error);
      if (json) {
        emit({
          event: "error",
          step: error?.step,
          message: error?.message || String(error),
          detail,
        });
      } else {
        console.error(error);
      }
    },
  };
}
