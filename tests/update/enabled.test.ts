// The old install's key set false in a settings file's text by one targeted edit: the one textual `"<key>": true`
// becomes `"<key>": false` and every other byte stays. Text that is not one JSON object, whose enabledPlugins does not
// hold the key set true, or where that text is not found exactly once, is never rewritten: 'parse' or 'key' says which.
import { expect, test } from 'claude-code/testing'

import { switchOffPlugin } from '../../hooks/update/enabled'

const KEY = 'session-inspector@envoydev'

test('switchOffPlugin changes the one value and leaves every other byte as it was', () => {
  const text = `{\n  "theme": "dark",   \n  "enabledPlugins": {\n    "a@x": true,\n    "${KEY}" :   true ,\n    "b@x": false\n  },\n  "model": "opus"\n}\n`
  expect(switchOffPlugin(text, KEY)).toEqual({ text: text.replace(`"${KEY}" :   true`, `"${KEY}" :   false`) })
})

test('switchOffPlugin keeps CRLF line ends, tabs and a missing last newline', () => {
  const crlf = `{\r\n\t"enabledPlugins": {\r\n\t\t"${KEY}": true\r\n\t}\r\n}\r\n`
  expect(switchOffPlugin(crlf, KEY)).toEqual({ text: crlf.replace('true', 'false') })
  const bare = `{\n  "enabledPlugins": { "${KEY}": true }\n}`
  expect(switchOffPlugin(bare, KEY)).toEqual({ text: bare.replace('true', 'false') })
})

test('switchOffPlugin edits a minified one-line file in place', () => {
  const text = `{"theme":"dark","enabledPlugins":{"a@x":true,"${KEY}":true},"model":"opus"}`
  expect(switchOffPlugin(text, KEY)).toEqual({ text: `{"theme":"dark","enabledPlugins":{"a@x":true,"${KEY}":false},"model":"opus"}` })
})

test('switchOffPlugin never rewrites text that is not one JSON object', () => {
  expect(switchOffPlugin('{ not json', KEY)).toEqual({ why: 'parse' })
  expect(switchOffPlugin('[1]', KEY)).toEqual({ why: 'parse' })
  expect(switchOffPlugin(null, KEY)).toEqual({ why: 'parse' })
  expect(switchOffPlugin('  \n', KEY)).toEqual({ why: 'parse' })
})

test('switchOffPlugin never rewrites a file whose enabledPlugins is no object or does not hold the key set true', () => {
  expect(switchOffPlugin('{ "enabledPlugins": [true] }', KEY)).toEqual({ why: 'key' })
  expect(switchOffPlugin('{ "enabledPlugins": "on" }', KEY)).toEqual({ why: 'key' })
  expect(switchOffPlugin('{ "theme": "dark" }', KEY)).toEqual({ why: 'key' })
  expect(switchOffPlugin(`{ "enabledPlugins": { "${KEY}": false } }`, KEY)).toEqual({ why: 'key' })
  expect(switchOffPlugin('{ "enabledPlugins": { "other@x": true } }', KEY)).toEqual({ why: 'key' })
})

test('switchOffPlugin writes nothing where the key and true occur more than once, or not as written', () => {
  expect(switchOffPlugin(`{ "enabledPlugins": { "${KEY}": true }, "other": { "${KEY}": true } }`, KEY)).toEqual({ why: 'key' })
  expect(switchOffPlugin('{ "enabledPlugins": { "session-inspector\\u0040envoydev": true } }', KEY)).toEqual({ why: 'key' })
})
