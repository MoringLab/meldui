import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
export const SandboxRequestSchema = z
  .object({
    mode: z.enum(["html", "app"]),
    source: z.string().min(1).max(131072),
    width: z.number().int().min(320).max(960).default(640),
    height: z.number().int().min(200).max(800).default(480),
    events: z
      .array(
        z.union([
          z
            .object({
              type: z.literal("click"),
              x: z.number().min(0).max(960),
              y: z.number().min(0).max(800),
            })
            .strict(),
          z
            .object({
              type: z.literal("key"),
              key: z.enum([
                "Enter",
                "Space",
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Tab",
              ]),
            })
            .strict(),
        ]),
      )
      .max(20)
      .default([]),
    allowedActions: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .max(10)
      .default([]),
    namespace: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .default("surface"),
    data: z
      .record(
        z.union([
          z.string().max(1024),
          z.number().finite(),
          z.boolean(),
          z.array(z.union([z.string().max(128), z.number().finite(), z.boolean()])).max(100),
        ]),
      )
      .refine((v) => JSON.stringify(v).length <= 8192)
      .default({}),
    theme: z.record(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).default({}),
  })
  .strict();
export type SandboxRequest = z.input<typeof SandboxRequestSchema>;
export type SandboxResult = {
  screenshot: string;
  text: string;
  actions: { name: string }[];
  consoleErrors: string[];
  violations: string[];
};
export class DockerSandboxRuntime {
  private active = 0;
  constructor(
    readonly image = "engine-sandbox:1.58.2",
    private timeoutMs = 8000,
  ) {}
  fingerprint() {
    const imageId = execFileSync(
      "docker",
      ["image", "inspect", this.image, "--format", "{{.Id}}"],
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    return createHash("sha256")
      .update(
        imageId +
          readFileSync(fileURLToPath(new URL("../worker.cjs", import.meta.url))) +
          readFileSync(fileURLToPath(new URL("../seccomp_profile.json", import.meta.url))) +
          JSON.stringify({
            policy: 2,
            timeoutMs: this.timeoutMs,
            network: "none",
            readOnly: true,
            memory: 512,
            cpus: 0.5,
            pids: 96,
            concurrency: 2,
            capDrop: "ALL",
            noNewPrivileges: true,
          }),
      )
      .digest("hex");
  }
  verified(file = "artifacts/sandbox/attestation.json") {
    try {
      if (!existsSync(file)) return false;
      const proof = JSON.parse(readFileSync(file, "utf8"));
      return proof.passed === true && proof.fingerprint === this.fingerprint();
    } catch {
      return false;
    }
  }
  async run(input: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult> {
    const request = SandboxRequestSchema.parse(input);
    if (signal?.aborted) throw new Error("SANDBOX_CANCELLED");
    if (this.active >= 2) throw new Error("SANDBOX_CONCURRENCY_LIMIT");
    this.active++;
    const name = `engine-sandbox-${randomUUID()}`;
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--init",
        "-i",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=128m",
        "--memory",
        "512m",
        "--memory-swap",
        "512m",
        "--cpus",
        "0.5",
        "--pids-limit",
        "96",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--security-opt",
        `seccomp=${fileURLToPath(new URL("../seccomp_profile.json", import.meta.url))}`,
        this.image,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    return new Promise((resolve, reject) => {
      let output = "",
        error = "",
        finished = false;
      const kill = () => {
        child.kill("SIGKILL");
        const remove = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
        remove.unref();
      };
      const finish = (cause?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.active--;
        if (cause) {
          kill();
          reject(cause);
        } else
          try {
            const value = JSON.parse(output);
            if (
              !/^[A-Za-z0-9+/=]+$/.test(value.screenshot) ||
              value.screenshot.length > 2_000_000 ||
              !Array.isArray(value.actions)
            )
              throw new Error("SANDBOX_OUTPUT");
            resolve(value);
          } catch {
            reject(new Error("SANDBOX_OUTPUT"));
          }
      };
      const timer = setTimeout(() => finish(new Error("SANDBOX_WATCHDOG")), this.timeoutMs);
      const abort = () => finish(new Error("SANDBOX_CANCELLED"));
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", (err) => finish(err));
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 2_100_000) finish(new Error("SANDBOX_OUTPUT_LIMIT"));
      });
      child.stderr.on("data", (chunk) => {
        if (error.length < 1000) error += chunk;
      });
      child.on("close", (code) =>
        finish(code === 0 ? undefined : new Error(`SANDBOX_PROCESS_${code}: ${error.slice(-300)}`)),
      );
      child.stdin.end(JSON.stringify(request));
    });
  }
}
