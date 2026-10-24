// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** Removes ANSI colour codes that Paper prints to the console. */
export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_PATTERN, "");
}

/** Sleeps for the given milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
