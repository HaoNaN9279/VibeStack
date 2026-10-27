import { execFile } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type JsonRecord = Record<string, any>

const RESOLVE_SCHEMA_VERSION = 1
const DEFAULT_TIMEOUT_MS = 5000
const MAX_BUFFER = 16 * 1024 * 1024

export interface Injection {
  instructions: string[]
  skillPaths: string[]
  agents: Record<string, JsonRecord>
  commands: Record<string, JsonRecord>
  mcp: Record<string, JsonRecord>
  warnings: string[]
}

interface ResolvePlan {
  schema_version: number
  active: boolean
  rules?: unknown
  skills?: unknown
  agents?: unknown
  commands?: unknown
  mcp?: unknown
  warnings?: unknown
}

interface ExecOptions {
  timeout: number
  maxBuffer: number
}

interface ExecResult {
  stdout: string
  stderr: string
}

export type ResolveExecutor = (
  command: string,
  args: string[],
  options: ExecOptions,
) => Promise<ExecResult>

export async function loadInjection(
  projectDir: string,
  pluginDir: string,
  execute: ResolveExecutor = defaultExecute,
): Promise<Injection> {
  const injection = emptyInjection()
  collectDefaultSkills(pluginDir, injection)

  const args = ["resolve", "--json", "--project", projectDir]
  let lastError = ""
  for (const command of cliCandidates()) {
    let result: ExecResult
    try {
      result = await execute(command, args, {
        timeout: resolveTimeout(),
        maxBuffer: MAX_BUFFER,
      })
    } catch (error) {
      lastError = errorText(error)
      if (isMissingCommand(error)) continue
      break
    }

    let plan: ResolvePlan
    try {
      plan = parsePlan(result.stdout)
    } catch (error) {
      injection.warnings.push(
        `vibe-stack resolve returned invalid plan: ${errorText(error)}`,
      )
      return injection
    }
    applyPlan(plan, injection)
    return injection
  }

  injection.warnings.push(
    `vibe-stack resolve failed: ${lastError || "command not found"}`,
  )
  return injection
}

export function applyInjection(config: JsonRecord, injection: Injection): JsonRecord {
  const instructions = Array.isArray(config.instructions) ? config.instructions : []
  config.instructions = Array.from(new Set([...instructions, ...injection.instructions]))

  if (Array.isArray(config.skills)) {
    config.skills = Array.from(new Set([...config.skills, ...injection.skillPaths]))
  } else {
    config.skills = config.skills && typeof config.skills === "object" ? config.skills : {}
    const paths = Array.isArray(config.skills.paths) ? config.skills.paths : []
    config.skills.paths = Array.from(new Set([...paths, ...injection.skillPaths]))
  }

  const agentKey = config.agents && !config.agent ? "agents" : "agent"
  config[agentKey] = config[agentKey] && typeof config[agentKey] === "object" ? config[agentKey] : {}
  for (const [name, agent] of Object.entries(injection.agents)) {
    const existing = config[agentKey][name] || {}
    config[agentKey][name] = { ...existing, ...stripUndefined(agent) }
  }

  const commandKey = config.commands && !config.command ? "commands" : "command"
  config[commandKey] = config[commandKey] && typeof config[commandKey] === "object" ? config[commandKey] : {}
  for (const [name, command] of Object.entries(injection.commands)) {
    const existing = config[commandKey][name] || {}
    config[commandKey][name] = { ...existing, ...stripUndefined(command) }
  }

  config.mcp = config.mcp && typeof config.mcp === "object" ? config.mcp : {}
  Object.assign(config.mcp, injection.mcp)
  return config
}

export const VibeStackPlugin = async (ctx: JsonRecord) => {
  const projectDir = String(ctx.directory || ctx.worktree || process.cwd())
  const pluginDir = path.dirname(fileURLToPath(import.meta.url))
  const injection = await loadInjection(projectDir, pluginDir)

  const log = async (level: string, message: string): Promise<void> => {
    try {
      await ctx.client?.app?.log({ body: { service: "vibestack", level, message } })
    } catch {
      // Logging must never block startup.
    }
  }

  return {
    config: async (config: JsonRecord) => {
      applyInjection(config, injection)
      for (const warning of injection.warnings) await log("warn", warning)
    },
  }
}

function emptyInjection(): Injection {
  return {
    instructions: [],
    skillPaths: [],
    agents: {},
    commands: {},
    mcp: {},
    warnings: [],
  }
}

function parsePlan(stdout: string): ResolvePlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.replace(/^\uFEFF/, ""))
  } catch {
    throw new Error("response is not valid JSON")
  }
  const plan = asRecord(parsed)
  if (plan.schema_version !== RESOLVE_SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version: ${String(plan.schema_version)}`)
  }
  return plan as unknown as ResolvePlan
}

function applyPlan(plan: ResolvePlan, injection: Injection): void {
  for (const item of asArray(plan.rules)) {
    const rule = asRecord(item)
    if (typeof rule.path === "string" && rule.path) {
      injection.instructions.push(rule.path)
    }
  }
  for (const item of asArray(plan.skills)) {
    const skill = asRecord(item)
    if (typeof skill.path === "string" && skill.path) {
      injection.skillPaths.push(skill.path)
    }
  }
  for (const [name, value] of Object.entries(asRecord(plan.agents))) {
    const agent = asRecord(value)
    injection.agents[name] = {
      description: asString(agent.description),
      mode: asString(agent.mode),
      system: asString(agent.system),
    }
  }
  for (const [name, value] of Object.entries(asRecord(plan.commands))) {
    const command = asRecord(value)
    injection.commands[name] = {
      description: asString(command.description),
      agent: asString(command.agent) || undefined,
      template: asString(command.template),
    }
  }
  for (const [key, value] of Object.entries(asRecord(plan.mcp))) {
    injection.mcp[key] = asRecord(value)
  }
  for (const warning of asArray(plan.warnings)) {
    if (typeof warning === "string") injection.warnings.push(warning)
  }
}

function collectDefaultSkills(pluginDir: string, injection: Injection): void {
  for (const candidate of [
    path.join(pluginDir, "skills"),
    path.join(pluginDir, "vibestack-skills"),
  ]) {
    if (!existsSync(candidate)) continue
    try {
      injection.skillPaths.push(...localSkillDirs(candidate).map(normalize))
    } catch (error) {
      injection.warnings.push(`cannot read default skills: ${errorText(error)}`)
    }
    return
  }
}

function localSkillDirs(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return []
  const dirs: string[] = []
  const walk = (dir: string, depth: number): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      dirs.push(dir)
      return
    }
    if (depth >= 6) return
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        walk(path.join(dir, entry.name), depth + 1)
      }
    }
  }
  walk(root, 0)
  return dirs.sort()
}

function cliCandidates(): string[] {
  const candidates = [process.env.VIBESTACK_CLI]
  if (process.platform === "win32") candidates.push("vibe-stack.exe")
  candidates.push("vibe-stack")
  return Array.from(
    new Set(candidates.filter((value): value is string => Boolean(value))),
  )
}

function resolveTimeout(): number {
  const raw = Number(process.env.VIBESTACK_RESOLVE_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

function defaultExecute(
  command: string,
  args: string[],
  options: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              stdout: String(stdout ?? ""),
              stderr: String(stderr ?? ""),
            }),
          )
          return
        }
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") })
      },
    )
  })
}

function isMissingCommand(error: unknown): boolean {
  return asRecord(error).code === "ENOENT"
}

function errorText(error: unknown): string {
  const value = asRecord(error)
  const stderr = typeof value.stderr === "string" ? value.stderr.trim() : ""
  if (stderr) return stderr
  if (error instanceof Error) return error.message
  return String(error)
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function stripUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function normalize(file: string): string {
  return path.resolve(file).replaceAll("\\", "/")
}
