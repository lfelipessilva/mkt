let busy = false;
let lastStatus = { state: "idle", at: null, detail: null };

export function getJobStatus() {
  return { busy, ...lastStatus };
}

export function setJobStatus(state, detail = null) {
  lastStatus = { state, at: new Date().toISOString(), detail };
}

export async function withJobLock(fn) {
  if (busy) {
    const err = new Error("já tem um job rodando");
    err.code = "BUSY";
    throw err;
  }
  busy = true;
  setJobStatus("running");
  try {
    const result = await fn();
    setJobStatus("ok", result?.summary ?? null);
    return result;
  } catch (e) {
    setJobStatus("error", e.message);
    throw e;
  } finally {
    busy = false;
  }
}
