/** The wait before each try while the server cannot be reached: 1 s, 2 s, 4 s, … up to the longest wait. */
export function retryDelayMs(attempt: number, maxSeconds: number): number {
    const seconds = Math.min(maxSeconds, 2 ** Math.max(0, Math.min(attempt, 20)));

    return seconds * 1000;
}
