// Error type thrown by the API layer (Firebase callables or the demo API).

export class CallableError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: { path: string; message: string }[] | unknown,
    public requestId?: string,
  ) {
    super(message);
  }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as { path: string; message: string }[]) if (d?.path) out[d.path] = d.message;
    }
    return out;
  }
}
