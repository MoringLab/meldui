import { seededRandom } from "./expression.js";
export type SimulationKind = "nBody" | "cellular" | "agents";
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: number;
  mass?: number;
  energy?: number;
  trait?: number;
};
export type SimulationSnapshot = {
  module: SimulationKind;
  seed: number;
  step: number;
  draw: number;
  particles: Particle[];
  metrics: Record<string, number>;
};
/** Bounded, deterministic reference models supplied by the host, never generated code. */
export function createSimulation(
  module: SimulationKind,
  seed: number,
  params: { count?: number; gravity?: number; size?: number } = {},
) {
  const count = params.count ?? 24,
    size = params.size ?? 24,
    g = params.gravity ?? 0.3;
  if (!["nBody", "cellular", "agents"].includes(module) || !Number.isInteger(seed))
    throw Error("SIMULATION_PARAMS");
  if (
    !Number.isInteger(count) ||
    count < 2 ||
    count > 64 ||
    !Number.isInteger(size) ||
    size < 8 ||
    size > 64 ||
    !Number.isFinite(g) ||
    g < 0 ||
    g > 10
  )
    throw Error("SIMULATION_BUDGET");
  let disposed = false,
    frame = 0,
    draw = 0;
  const random = () => seededRandom(seed, draw++ % 1000001);
  let particles: Particle[] = [];
  const initialize = () => {
    draw = 0;
    frame = 0;
    if (module === "nBody")
      particles = Array.from({ length: count }, (_, i) => {
        if (!i) return { x: 0.5, y: 0.5, vx: 0, vy: 0, kind: 2, mass: 1 };
        const r = 0.1 + (0.32 * i) / count,
          a = i * 2.399963,
          v = Math.sqrt((g * r * r) / (r * r + 0.002) ** 1.5);
        return {
          x: 0.5 + r * Math.cos(a),
          y: 0.5 + r * Math.sin(a),
          vx: -v * Math.sin(a),
          vy: v * Math.cos(a),
          kind: 0,
          mass: 0.00001,
        };
      });
    else if (module === "cellular") {
      const occupied = new Set<number>();
      particles = Array.from({ length: Math.min(Math.floor((size * size) / 3), 512) }, (_, i) => {
        let cell = Math.floor(random() * size * Math.max(1, Math.floor(size / 2)));
        while (occupied.has(cell)) cell = (cell + 1) % (size * size);
        occupied.add(cell);
        return {
          x: (cell % size) / size,
          y: Math.floor(cell / size) / size,
          vx: 0,
          vy: 0,
          kind: i % 3,
        };
      });
    } else
      particles = Array.from({ length: count }, (_, i) => ({
        x: random(),
        y: random(),
        vx: 0,
        vy: 0,
        kind: i % 3,
        energy: i % 3 === 0 ? 1 : 2,
        trait: 0.3 + random() * 0.7,
      }));
  };
  initialize();
  const check = () => {
    if (disposed) throw Error("SIMULATION_DISPOSED");
  };
  const acceleration = (state: Particle[]) =>
    state.map((p, i) => {
      let ax = 0,
        ay = 0;
      state.forEach((q, j) => {
        if (i === j) return;
        const dx = q.x - p.x,
          dy = q.y - p.y,
          d = (dx * dx + dy * dy + 0.002) ** 1.5,
          force = (g * (q.mass ?? 1)) / d;
        ax += force * dx;
        ay += force * dy;
      });
      return { ax, ay };
    });
  const snapshot = (): SimulationSnapshot => {
    check();
    let energy = particles.reduce(
      (s, p) => s + 0.5 * (p.mass ?? 1) * (p.vx * p.vx + p.vy * p.vy),
      0,
    );
    if (module === "nBody")
      for (let i = 0; i < particles.length; i++)
        for (let j = 0; j < i; j++) {
          const p = particles[i]!,
            q = particles[j]!;
          energy -=
            (g * (p.mass ?? 1) * (q.mass ?? 1)) /
            Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + 0.002);
        }
    const traits = particles.filter((p) => p.kind === 1).map((p) => p.trait ?? 0);
    return {
      module,
      seed,
      step: frame,
      draw,
      particles: particles.map((p) => ({ ...p })),
      metrics: {
        count: particles.length,
        energy,
        predators: particles.filter((p) => p.kind === 2).length,
        prey: particles.filter((p) => p.kind === 1).length,
        food: particles.filter((p) => p.kind === 0).length,
        meanTrait: traits.reduce((s, x) => s + x, 0) / Math.max(1, traits.length),
        sand: module === "cellular" ? particles.filter((p) => p.kind === 0).length : 0,
        water: module === "cellular" ? particles.filter((p) => p.kind === 1).length : 0,
      },
    };
  };
  const step = (dt = 1 / 60) => {
    check();
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw Error("SIMULATION_STEP_BUDGET");
    if (module === "nBody") {
      // Velocity Verlet with a fixed upper bound on work, no timer inside the module.
      const n = Math.min(16, Math.max(1, Math.ceil(dt * 240))),
        h = dt / n;
      for (let k = 0; k < n; k++) {
        const a = acceleration(particles);
        const moved = particles.map((p, i) => ({
          ...p,
          x: p.x + p.vx * h + 0.5 * a[i]!.ax * h * h,
          y: p.y + p.vy * h + 0.5 * a[i]!.ay * h * h,
        }));
        const b = acceleration(moved);
        particles = moved.map((p, i) => ({
          ...p,
          vx: p.vx + 0.5 * (a[i]!.ax + b[i]!.ax) * h,
          vy: p.vy + 0.5 * (a[i]!.ay + b[i]!.ay) * h,
        }));
      }
    }
    if (module === "cellular") {
      const cell = (p: Particle) => Math.round(p.y * size) * size + Math.round(p.x * size);
      const occupied = new Set(particles.map(cell));
      const ordered = [...particles].sort((a, b) => b.y - a.y);
      for (const p of ordered) {
        const x = Math.round(p.x * size),
          y = Math.round(p.y * size),
          direction = random() < 0.5 ? -1 : 1;
        const targets =
          p.kind === 2
            ? [
                [x, y - 1],
                [x + direction, y - 1],
              ]
            : [[x, y + 1], [x + direction, y + 1], ...(p.kind === 1 ? [[x + direction, y]] : [])];
        for (const [nx, ny] of targets) {
          if (nx! < 0 || nx! >= size || ny! < 0 || ny! >= size || occupied.has(ny! * size + nx!))
            continue;
          occupied.delete(cell(p));
          p.x = nx! / size;
          p.y = ny! / size;
          occupied.add(cell(p));
          break;
        }
      }
    }
    if (module === "agents") {
      const gone = new Set<Particle>(),
        born: Particle[] = [];
      for (const p of particles) {
        if (p.kind === 0) continue;
        const targetKind = p.kind === 2 ? 1 : 0;
        const targets = particles.filter((q) => q.kind === targetKind && !gone.has(q));
        const target = targets.sort(
          (a, b) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2 - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2),
        )[0];
        const dx = target ? target.x - p.x : random() - 0.5,
          dy = target ? target.y - p.y : random() - 0.5,
          d = Math.hypot(dx, dy) || 1,
          speed = (p.trait ?? 0.5) * 0.12;
        p.vx = (dx / d) * speed;
        p.vy = (dy / d) * speed;
        p.x = Math.max(0, Math.min(1, p.x + p.vx * dt));
        p.y = Math.max(0, Math.min(1, p.y + p.vy * dt));
        p.energy = (p.energy ?? 1) - dt * (0.08 + speed);
        if (target && d < 0.04) {
          gone.add(target);
          p.energy += targetKind === 0 ? 0.7 : 1.6;
        }
        if (p.energy <= 0) gone.add(p);
        if (p.energy > 3.5 && particles.length + born.length < 128) {
          p.energy /= 2;
          born.push({
            ...p,
            trait: Math.max(0.1, Math.min(1, (p.trait ?? 0.5) + (random() - 0.5) * 0.08)),
          });
        }
      }
      particles = particles.filter((p) => !gone.has(p)).concat(born);
      if (frame % 12 === 0 && particles.length < 128)
        particles.push({ x: random(), y: random(), vx: 0, vy: 0, kind: 0, energy: 1 });
    }
    frame++;
    return snapshot();
  };
  return {
    step,
    snapshot,
    metrics: () => snapshot().metrics,
    restore: (saved: SimulationSnapshot) => {
      check();
      if (
        saved.module !== module ||
        saved.seed !== seed ||
        !Number.isInteger(saved.step) ||
        saved.step < 0 ||
        !Number.isInteger(saved.draw) ||
        saved.draw < 0 ||
        saved.draw > 1000000000 ||
        !Array.isArray(saved.particles) ||
        saved.particles.length > (module === "cellular" ? 1024 : 128) ||
        saved.particles.some(
          (p) =>
            ![p.x, p.y, p.vx, p.vy, p.kind, p.mass ?? 1, p.energy ?? 1, p.trait ?? 0.5].every(
              Number.isFinite,
            ) ||
            Math.abs(p.x) > 100 ||
            Math.abs(p.y) > 100 ||
            (p.mass ?? 1) <= 0 ||
            (p.mass ?? 1) > 10 ||
            Math.abs(p.vx) > 20 ||
            Math.abs(p.vy) > 20 ||
            ![0, 1, 2].includes(p.kind),
        )
      )
        throw Error("SIMULATION_SNAPSHOT");
      particles = saved.particles.map((p) => ({ ...p }));
      frame = saved.step;
      draw = saved.draw;
      return snapshot();
    },
    reset: () => {
      check();
      initialize();
      return snapshot();
    },
    pour: (kind = 1) => {
      check();
      if (module !== "cellular" || ![0, 1, 2].includes(kind)) throw Error("SIMULATION_MATERIAL");
      const occupied = new Set(
        particles.map((p) => Math.round(p.y * size) * size + Math.round(p.x * size)),
      );
      for (let x = 0; x < size && particles.length < Math.min(size * size, 1024); x++)
        if (!occupied.has(x)) particles.push({ x: x / size, y: 0, vx: 0, vy: 0, kind });
      return snapshot();
    },
    dispose: () => {
      disposed = true;
      particles = [];
    },
  };
}
