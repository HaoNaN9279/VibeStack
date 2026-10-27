import { describe, expect, test } from "bun:test"

import {
  applyInjection,
  loadInjection,
  type JsonRecord,
  type ResolveExecutor,
} from "./index"

function basePlan(overrides: JsonRecord = {}): JsonRecord {
  return {
    schema_version: 1,
    active: true,
    rules: [{ name: "global", path: "/repo/rules/global.md" }],
    skills: [{ name: "api-skill", path: "/repo/skills/api-skill" }],
    agents: {
      Helper: {
        description: "helper",
        mode: "subagent",
        system: "# Helper",
        source: "/repo/agents/helper.md",
        group: "core",
      },
    },
    commands: {
      run: {
        description: "run",
        agent: "Helper",
        template: "run it",
        source: "/repo/commands/run.md",
        group: "core",
      },
    },
    mcp: {
      "vibe:core_demo": { type: "remote", url: "http://example.test/mcp" },
    },
    warnings: [],
    ...overrides,
  }
}

function executor(
  plan: JsonRecord | string,
  calls?: unknown[][],
): ResolveExecutor {
  return async (command, args) => {
    calls?.push([command, ...args])
    return {
      stdout: typeof plan === "string" ? plan : JSON.stringify(plan),
      stderr: "",
    }
  }
}

describe("loadInjection", () => {
  test("maps the resolve plan and default skill", async () => {
    const calls: unknown[][] = []
    const injection = await loadInjection(
      "/tmp/project",
      import.meta.dir,
      executor(basePlan(), calls),
    )
    expect(["vibe-stack", "vibe-stack.exe"]).toContain(calls[0][0])
    expect(calls[0].slice(1)).toEqual([
      "resolve",
      "--json",
      "--project",
      "/tmp/project",
    ])
    expect(injection.instructions).toEqual(["/repo/rules/global.md"])
    expect(injection.skillPaths).toContain("/repo/skills/api-skill")
    expect(injection.skillPaths.some((item) => item.includes("vibestack"))).toBe(true)
    expect(injection.agents.Helper).toEqual({
      description: "helper",
      mode: "subagent",
      system: "# Helper",
    })
    expect(injection.commands.run.agent).toBe("Helper")
    expect(injection.mcp["vibe:core_demo"].url).toBe("http://example.test/mcp")
  })

  test("inactive plan only loads the default skill", async () => {
    const injection = await loadInjection(
      "/tmp/project",
      import.meta.dir,
      executor(basePlan({ active: false, rules: [], skills: [], agents: {}, commands: {}, mcp: {}, warnings: [] })),
    )
    expect(injection.instructions).toEqual([])
    expect(Object.keys(injection.agents)).toEqual([])
    expect(injection.skillPaths.length).toBe(1)
    expect(injection.warnings).toEqual([])
  })

  test("invalid JSON keeps startup alive", async () => {
    const injection = await loadInjection(
      "/tmp/project",
      import.meta.dir,
      executor("{"),
    )
    expect(injection.skillPaths.length).toBe(1)
    expect(injection.warnings.some((item) => item.includes("not valid JSON"))).toBe(true)
  })

  test("unsupported schema keeps startup alive", async () => {
    const injection = await loadInjection(
      "/tmp/project",
      import.meta.dir,
      executor(basePlan({ schema_version: 2 })),
    )
    expect(injection.skillPaths.length).toBe(1)
    expect(
      injection.warnings.some((item) => item.includes("unsupported schema_version")),
    ).toBe(true)
  })

  test("CLI failure keeps startup alive", async () => {
    const run: ResolveExecutor = async () => {
      throw new Error("resolve timed out")
    }
    const injection = await loadInjection("/tmp/project", import.meta.dir, run)
    expect(injection.skillPaths.length).toBe(1)
    expect(injection.warnings.some((item) => item.includes("resolve timed out"))).toBe(true)
  })

  test("plan warnings are forwarded", async () => {
    const injection = await loadInjection(
      "/tmp/project",
      import.meta.dir,
      executor(basePlan({ warnings: ["group missing"] })),
    )
    expect(injection.warnings).toEqual(["group missing"])
  })
})

describe("applyInjection", () => {
  test("supports v1 skills.paths", () => {
    const config: JsonRecord = { skills: { paths: ["old"] } }
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
    const config: JsonRecord = { skills: ["old"], agents: {} }
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
    const config: JsonRecord = {
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

  test("is idempotent", () => {
    const config: JsonRecord = {}
    const injection = {
      instructions: ["a.md"],
      skillPaths: ["skills"],
      agents: {},
      commands: {},
      mcp: {},
      warnings: [],
    }
    applyInjection(config, injection)
    applyInjection(config, injection)
    expect(config.instructions).toEqual(["a.md"])
    expect(config.skills.paths).toEqual(["skills"])
  })
})
