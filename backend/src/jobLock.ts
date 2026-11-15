export interface JobStatus {
  busy: boolean;
  state: "idle" | "running" | "ok" | "error";
  at: string | null;
  detail: string | null;
}

let busy = false;
let lastStatus: { state: "idle" | "running" | "ok" | "error"; at: string | null; detail: string | null } = {
  state: "idle",
  at: null,
  detail: null,
};

export function getJobStatus(): JobStatus {
  return { busy, ...lastStatus };
}

export function setJobStatus(state: "idle" | "running" | "ok" | "error", detail: string | null = null): void {
  lastStatus = { state, at: new Date().toISOString(), detail };
}

export async function withJobLock<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) {
    const err: any = new Error("já tem um job rodando");
    err.code = "BUSY";
    throw err;
  }
  busy = true;
  setJobStatus("running");
  try {
    const result = await fn();
    const summary = (result as any)?.summary ?? null;
    setJobStatus("ok", summary);
    return result;
  } catch (e: any) {
    setJobStatus("error", e.message);
    throw e;
  } finally {
    busy = false;
  }
}
