import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type JsonRecord = Record<string, any>

export interface Injection {
  instructions: string[]
  skillPaths: string[]
  agents: Record<string, JsonRecord>
  commands: Record<string, JsonRecord>
  mcp: Record<string, JsonRecord>
  warnings: string[]
}

export function parseFrontmatter(text: string): { data: JsonRecord; body: string } {
  if (!text.startsWith("---")) return { data: {}, body: text }
  const lines = text.split(/\r?\n/)
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i
      break
    }
  }
  if (end === -1) return { data: {}, body: text }

  const data: JsonRecord = {}
  let currentKey = ""
  for (let i = 1; i < end; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const listItem = line.match(/^\s*-\s+(.*)$/)
    if (listItem && currentKey) {
      const value = unquote(listItem[1])
      const existing = data[currentKey]
      data[currentKey] = Array.isArray(existing) ? [...existing, value] : [value]
      continue
    }
    if (/^\s+/.test(line)) continue
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    currentKey = match[1]
    data[currentKey] = parseScalar(match[2])
  }
  return { data, body: lines.slice(end + 1).join("\n").trim() }
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ""
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => unquote(item.trim()))
      .filter(Boolean)
  }
  return unquote(value)
}

function unquote(value: string): string {
  const text = value.trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

function readJson(file: string): JsonRecord | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as JsonRecord
  } catch {
    return null
  }
}

function versionKey(version: string): number[] {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return [0, 0, 0]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function latestVersion(repo: string, name: string): string | null {
  const base = path.join(repo, "capability-groups", name)
  if (!existsSync(base)) return null
  const versions = readdirSync(base).filter((entry) =>
    existsSync(path.join(base, entry, "group.json")),
  )
  versions.sort((a, b) => {
    const left = versionKey(a)
    const right = versionKey(b)
    for (let i = 0; i < 3; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i]
    }
    return 0
  })
  return versions.at(-1) ?? null
}

export function loadGroup(repo: string, name: string, version?: string): JsonRecord | null {
  const resolved = version || latestVersion(repo, name)
  if (!resolved) return null
  const root = path.join(repo, "capability-groups", name, resolved)
  const meta = readJson(path.join(root, "group.json"))
  if (!meta) return null
  return { ...meta, root }
}

export function resolveGroups(repo: string, stack: JsonRecord): { groups: JsonRecord[]; warnings: string[] } {
  const warnings: string[] = []
  const ordered: JsonRecord[] = []
  const seen = new Set<string>()
  const refs = new Map<string, JsonRecord>()
  for (const ref of Array.isArray(stack.groups) ? stack.groups : []) {
    if (ref && ref.name) refs.set(String(ref.name), ref)
  }

  const add = (name: string, version?: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    const group = loadGroup(repo, name, version || refs.get(name)?.version)
    if (!group) {
      warnings.push(`capability group not found: ${name}${version ? `@${version}` : ""}`)
      return
    }
    for (const dependency of Array.isArray(group.extends) ? group.extends : []) {
      add(String(dependency), refs.get(String(dependency))?.version)
    }
    ordered.push(group)
  }

  if (stack.core && stack.core.name) {
    add(String(stack.core.name), stack.core.version)
  }
  for (const ref of Array.isArray(stack.groups) ? stack.groups : []) {
    if (ref && ref.name && ref.name !== "core") add(String(ref.name), ref.version)
  }
  return { groups: ordered, warnings }
}

function mdFiles(dir: string, recursive = false): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const files: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (recursive) files.push(...mdFiles(full, true))
    } else if (entry.endsWith(".md")) {
      files.push(full)
    }
  }
  return files
}

function toolIndex(repo: string): Map<string, JsonRecord> {
  const index = new Map<string, JsonRecord>()
  const base = path.join(repo, "tools")
  if (!existsSync(base)) return index
  for (const name of readdirSync(base)) {
    const versionsDir = path.join(base, name)
    if (!statSync(versionsDir).isDirectory()) continue
    for (const version of readdirSync(versionsDir)) {
      const root = path.join(versionsDir, version)
      const meta = readJson(path.join(root, "tool.json"))
      if (!meta) continue
      index.set(`tool:${meta.guid}@v${meta.version}`, { ...meta, root })
      index.set(`${meta.name}@${meta.version}`, { ...meta, root })
    }
  }
  return index
}

function normalize(file: string): string {
  return path.resolve(file).replaceAll("\\", "/")
}

export function buildInjection(repo: string | null, stack: JsonRecord | null, pluginDir: string): Injection {
  const injection: Injection = {
    instructions: [],
    skillPaths: [],
    agents: {},
    commands: {},
    mcp: {},
    warnings: [],
  }

  for (const candidate of [
    path.join(pluginDir, "skills"),
    path.join(pluginDir, "vibestack-skills"),
  ]) {
    if (existsSync(candidate)) {
      injection.skillPaths.push(normalize(candidate))
      break
    }
  }

  if (!repo) {
    injection.warnings.push("VibeStack repository is not configured")
    return injection
  }
  if (!stack) return injection

  const { groups, warnings } = resolveGroups(repo, stack)
  injection.warnings.push(...warnings)
  const tools = toolIndex(repo)

  for (const group of groups) {
    const root = String(group.root)
    injection.instructions.push(...mdFiles(path.join(root, "rules"), true).map(normalize))

    const skills = path.join(root, "skills")
    if (existsSync(skills)) injection.skillPaths.push(normalize(skills))

    for (const file of mdFiles(path.join(root, "agents"))) {
      const parsed = parseFrontmatter(readFileSync(file, "utf8"))
      const name = String(parsed.data.name || path.basename(file, ".md"))
      injection.agents[name] = {
        description: parsed.data.description,
        mode: parsed.data.mode,
        system: parsed.body,
      }
    }

    for (const file of mdFiles(path.join(root, "commands"))) {
      const parsed = parseFrontmatter(readFileSync(file, "utf8"))
      const name = String(parsed.data.name || path.basename(file, ".md"))
      injection.commands[name] = {
        description: parsed.data.description,
        agent: parsed.data.agent,
        template: parsed.body,
      }
    }

    for (const toolId of Array.isArray(group.tools) ? group.tools : []) {
      const tool = tools.get(String(toolId))
      if (!tool) {
        injection.warnings.push(`tool not found for ${group.name}: ${toolId}`)
        continue
      }
      if (!tool.mcp) continue
      const server = tool.mcp as JsonRecord
      if (server.enabled === false) continue
      const key = `vibe:${group.name}_${String(server.name || tool.name)}`
      const config = { ...server }
      delete config.name
      injection.mcp[key] = config
    }
  }
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

function stripUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

export function resolveRepo(): string | null {
  for (const key of ["VIBESTACK_HOME", "VIBESTACK_REPO"]) {
    const value = process.env[key]
    if (value) return value
  }
  try {
    const file = path.join(homedir(), ".config", "vibestack", "config.json")
    const config = readJson(file)
    if (config && typeof config.repository === "string" && config.repository) {
      return config.repository
    }
  } catch {
    // Ignore unreadable global config.
  }
  return null
}

export function loadProjectStack(projectDir: string): JsonRecord | null {
  let current = path.resolve(projectDir)
  for (;;) {
    const file = path.join(current, ".vibestack", "stack.json")
    if (existsSync(file)) return readJson(file)
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export const VibeStackPlugin = async (ctx: JsonRecord) => {
  const projectDir = String(ctx.directory || ctx.worktree || process.cwd())
  const pluginDir = path.dirname(fileURLToPath(import.meta.url))
  const injection = buildInjection(resolveRepo(), loadProjectStack(projectDir), pluginDir)

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
