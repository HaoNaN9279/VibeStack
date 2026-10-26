import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"

import {
  applyInjection,
  buildInjection,
  parseFrontmatter,
  resolveGroups,
} from "./index"

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content, "utf8")
}

function fixtureRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "vibestack-plugin-"))
  write(
    path.join(repo, "capability-groups/core/0.1.0/group.json"),
    JSON.stringify({ guid: "a".repeat(32), name: "core", version: "0.1.0", description: "core", tools: [] }),
  )
  write(path.join(repo, "capability-groups/core/0.1.0/rules/global.md"), "# global\n")
  write(
    path.join(repo, "capability-groups/core/0.1.0/agents/helper.md"),
    "---\nname: Helper\ndescription: helper\nmode: subagent\n---\n\n# Helper\n",
  )
  write(path.join(repo, "capability-groups/core/0.1.0/skills/core-skill/SKILL.md"), "# core\n")
  write(
    path.join(repo, "capability-groups/data/1.0.0/group.json"),
    JSON.stringify({
      guid: "b".repeat(32),
      name: "data",
      version: "1.0.0",
      description: "data",
      extends: ["base"],
      tools: ["tool:" + "c".repeat(32) + "@v0.1.0"],
    }),
  )
  write(path.join(repo, "capability-groups/data/1.0.0/rules/data.md"), "# data\n")
  write(
    path.join(repo, "capability-groups/base/1.0.0/group.json"),
    JSON.stringify({ guid: "d".repeat(32), name: "base", version: "1.0.0", description: "base", tools: [] }),
  )
  write(path.join(repo, "capability-groups/base/1.0.0/commands/run.md"), "---\ndescription: run\n---\n\nrun it\n")
  write(
    path.join(repo, "tools/demo/0.1.0/tool.json"),
    JSON.stringify({
      schema_version: 1,
      guid: "c".repeat(32),
      name: "demo",
      tool_name: "demo",
      version: "0.1.0",
      description: "demo",
      provider: "mcp",
      mcp: { name: "demo_mcp", type: "remote", url: "http://example.test/mcp" },
    }),
  )
  return repo
}

describe("parseFrontmatter", () => {
  test("reads scalars and body", () => {
    const parsed = parseFrontmatter("---\nname: X\ndescription: hello\n---\n\n# Body\n")
    expect(parsed.data.name).toBe("X")
    expect(parsed.body).toBe("# Body")
  })
})

describe("resolveGroups", () => {
  test("core first, dependencies before dependants", () => {
    const repo = fixtureRepo()
    const { groups } = resolveGroups(repo, {
      core: { name: "core", version: "0.1.0" },
      groups: [{ name: "data", version: "1.0.0" }],
    })
    expect(groups.map((group) => group.name)).toEqual(["core", "base", "data"])
  })
})

describe("buildInjection", () => {
  test("collects rules, agents, commands, skills and mcp", () => {
    const repo = fixtureRepo()
    const pluginDir = import.meta.dir
    const injection = buildInjection(
      repo,
      { core: { name: "core", version: "0.1.0" }, groups: [{ name: "data", version: "1.0.0" }] },
      pluginDir,
    )
    expect(injection.instructions.length).toBe(2)
    expect(injection.agents.Helper.system).toContain("# Helper")
    expect(injection.commands.run.template).toBe("run it")
    expect(injection.skillPaths.length).toBe(2)
    expect(injection.mcp["vibe:data_demo_mcp"].url).toBe("http://example.test/mcp")
    expect(injection.mcp["vibe:data_demo_mcp"].name).toBeUndefined()
    expect(injection.warnings).toEqual([])
  })

  test("no project stack only loads the default skill", () => {
    const pluginDir = import.meta.dir
    const injection = buildInjection(fixtureRepo(), null, pluginDir)
    expect(injection.instructions).toEqual([])
    expect(injection.skillPaths.length).toBe(1)
  })
})

describe("applyInjection", () => {
  test("supports v1 skills.paths", () => {
    const config: Record<string, any> = { skills: { paths: ["old"] } }
    applyInjection(config, {
      instructions: ["a.md"],
      skillPaths: ["skills"],
      agents: { Helper: { description: "h", system: "sys" } },
      commands: { run: { template: "x" } },
      mcp: { "vibe:core_x": { type: "remote", url: "u" } },
      warnings: [],
    })
    expect(config.skills.paths).toEqual(["old", "skills"])
    expect(config.agent.Helper.system).toBe("sys")
    expect(config.command.run.template).toBe("x")
    expect(config.mcp["vibe:core_x"].url).toBe("u")
  })

  test("supports v2 skills array and agents key", () => {
    const config: Record<string, any> = { skills: ["old"], agents: {} }
    applyInjection(config, {
      instructions: [],
      skillPaths: ["skills"],
      agents: { Helper: { description: "h", system: "sys" } },
      commands: {},
      mcp: {},
      warnings: [],
    })
    expect(config.skills).toEqual(["old", "skills"])
    expect(config.agents.Helper.description).toBe("h")
  })

  test("preserves model and permission from existing agent config", () => {
    const config: Record<string, any> = {
      agent: { Helper: { model: "x/y", permission: { edit: "allow" } } },
    }
    applyInjection(config, {
      instructions: [],
      skillPaths: [],
      agents: { Helper: { description: "h", system: "sys" } },
      commands: {},
      mcp: {},
      warnings: [],
    })
    expect(config.agent.Helper.model).toBe("x/y")
    expect(config.agent.Helper.permission.edit).toBe("allow")
    expect(config.agent.Helper.system).toBe("sys")
  })
})
