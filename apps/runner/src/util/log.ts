function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info(message: string): void {
    console.log(`[${ts()}] ${message}`);
  },
  warn(message: string): void {
    console.warn(`[${ts()}] ⚠ ${message}`);
  },
  error(message: string): void {
    console.error(`[${ts()}] ✖ ${message}`);
  },
};
