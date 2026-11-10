/** Client bundle: the factory registers the picker and the inventory button. */

import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const CLIENT = path.resolve(import.meta.dirname, '..', 'client.js')

/**
 * Minimal React surface: the bundle only touches these at registration time.
 * @returns {object} fake react module.
 */
function fakeReact() {
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol('Fragment'),
    useState: (value) => [value, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    useCallback: (fn) => fn,
    useLayoutEffect: () => {},
    Component: class Component {
      constructor(props) {
        this.props = props;
        this.state = {};
      }
    },
  }
  return react
}

/**
 * Load the bundle factory with stubbed globals.
 * @returns {Promise<object>} module exports from the factory.
 */
async function loadClient() {
  const registered = []
  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        assert.equal(definition.id, 'dsh-vibestack')
        registered.push(definition)
      },
    },
  }
  const require = (name) => {
    if (name === 'react') return fakeReact()
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${name}`)
  }
  globalThis.require = require
  await import(`${pathToFileURL(CLIENT).href}?t=${Date.now()}`)
  assert.equal(registered.length, 1)
  return registered[0].factory(require)
}

test('the client factory registers the picker and the inventory button', async () => {
  const exports = await loadClient()
  const slots = []
  const ctx = {
    effect: () => {},
    slots: {
      inject: (name, register) => slots.push({ name, register }),
      register: (options, component) => ({ options, component }),
    },
    remote: { commands: { execute: async () => ({ ok: true }) } },
  }
  exports.apply(ctx)
  const left = slots.filter((entry) => entry.name === 'conversation.input.left')
  assert.deepEqual(left.map((entry) => entry.register().options.id), [
    'vibestack-agent',
    'vibestack-inventory',
  ])
  assert.deepEqual(left.map((entry) => entry.register().options.order), [5, 8])
  const inventory = left[1].register()
  assert.deepEqual(inventory.options.inject('s1'), { sessionId: 's1' })
  assert.equal(typeof inventory.component, 'function')
  // A second mount is a no-op: one owner per bundle.
  exports.apply(ctx)
  assert.equal(slots.length, 3)
})

test('the models section stays available even before the layer route answers', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 500 })
  const exports = await loadClient()
  const sections = []
  const ctx = {
    effect: () => {},
    slots: {
      inject: (name, register) => {
        if (name === 'settings.section') sections.push(register())
      },
      register: (options, component) => ({ options, component }),
    },
    remote: { commands: { execute: async () => ({ ok: true }) } },
  }
  exports.apply(ctx)
  assert.deepEqual(sections.map((entry) => entry.options.id), ['vibestack-models'])
})
