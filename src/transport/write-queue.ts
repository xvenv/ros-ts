export interface WritableSocket {
  write(chunk: Buffer): boolean;
  once(event: 'drain', listener: () => void): unknown;
  off(event: 'drain', listener: () => void): unknown;
}

export class WriteQueue {
  private readonly socket: WritableSocket;
  private tail: Promise<void> = Promise.resolve();
  private failure: Error | undefined;
  private readonly waiters = new Set<(error: Error) => void>();

  constructor(socket: WritableSocket) {
    this.socket = socket;
  }

  write(chunk: Buffer): Promise<void> {
    const task = this.tail.then(() => this.writeNow(chunk));
    this.tail = task.catch(() => undefined);
    return task;
  }

  fail(error: Error): void {
    if (this.failure === undefined) this.failure = error;
    for (const reject of this.waiters) reject(error);
    this.waiters.clear();
  }

  private writeNow(chunk: Buffer): Promise<void> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.socket.write(chunk)) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let settled = false;
      const onDrain = (): void => {
        if (settled) return;
        settled = true;
        this.socket.off('drain', onDrain);
        this.waiters.delete(onFailure);
        resolve();
      };
      const onFailure = (error: Error): void => {
        if (settled) return;
        settled = true;
        this.socket.off('drain', onDrain);
        reject(error);
      };
      this.waiters.add(onFailure);
      this.socket.once('drain', onDrain);
    });
  }
}
