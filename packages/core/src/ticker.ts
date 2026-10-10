/** Host-driven clock. No autonomous interval: renderer visibility and reduced motion gate every step. */
export class Ticker {
  time = 0;
  frame = 0;
  dt = 0;
  playing = false;
  speed = 1;
  visible = true;
  reducedMotion = false;
  private disposed = false;
  constructor(private write: (values: Record<string, number | boolean>) => void) {}
  step(dt = 1 / 60, manual = false) {
    if (this.disposed || (!manual && (!this.playing || !this.visible || this.reducedMotion)))
      return;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1 || this.speed < 0.1 || this.speed > 8)
      throw new Error("TICKER_BUDGET");
    this.dt = dt * this.speed;
    this.time += this.dt;
    this.frame++;
    this.write({
      $time: this.time,
      $dt: this.dt,
      $frame: this.frame,
      playing: this.playing,
      speed: this.speed,
    });
  }
  restore(values: { time: number; frame: number; speed?: number }) {
    if (
      !Number.isFinite(values.time) ||
      values.time < 0 ||
      !Number.isInteger(values.frame) ||
      values.frame < 0 ||
      !Number.isFinite(values.speed ?? 1) ||
      (values.speed ?? 1) < 0.1 ||
      (values.speed ?? 1) > 8
    )
      throw Error("TICKER_SNAPSHOT");
    this.time = values.time;
    this.frame = values.frame;
    this.speed = values.speed ?? 1;
    this.playing = false;
  }
  reset() {
    this.time = this.dt = this.frame = 0;
    this.write({ $time: 0, $dt: 0, $frame: 0, playing: this.playing, speed: this.speed });
  }
  dispose() {
    this.disposed = true;
    this.playing = false;
  }
}
