/**
 * Tracks how many streams are over their high-water mark. The socket is
 * paused only on the 0->1 transition and resumed on 1->0, so one stream
 * draining cannot resume a socket that another stream still needs paused.
 */
export class PauseCounter {
  private count = 0;
  private readonly onPause: () => void;
  private readonly onResume: () => void;

  constructor(onPause: () => void, onResume: () => void) {
    this.onPause = onPause;
    this.onResume = onResume;
  }

  update(paused: boolean): void {
    if (paused) {
      this.count += 1;
      if (this.count === 1) this.onPause();
    } else if (this.count > 0) {
      this.count -= 1;
      if (this.count === 0) this.onResume();
    }
  }

  get paused(): boolean {
    return this.count > 0;
  }
}
