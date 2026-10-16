// tests/parse-modalities.test.ts — AST parser for CLI input modalities
import { parseInputModalities } from "../scripts/parse-modalities.mjs"
import { assertEqual, run, throws } from "./harness.js"

const BUNDLE = `
  const ALIAS = "alias/model"
  const MODELS = {
    FIRST: {
      label: "description with } and commas, inside a string",
      inputModalities: ["text", "image"],
      id: "first/model",
      nested: { id: "not-a-model", inputModalities: ["text"] },
    },
    SECOND: { id: ALIAS, name: "Alias", inputModalities: ["text"] },
    THIRD: { inputModalities: ["text"], id: "third/model", name: "Third" },
    RUNTIME: { id: request.id, inputModalities: ["text", "image"] },
  }
  const template = \`ignore \\${{ braces: true }}\`
  const regex = /[{}]/
`

run([
  [
    "collects contextWindows for catalog entries that carry them",
    () => {
      const withCtx = `const MODELS = {
        FIRST: { id: "first/model", name: "First", inputModalities: ["text"], contextWindow: 2e5 },
        SECOND: { id: "second/model", label: "Second", inputModalities: ["text"], contextWindow: 1e6 },
      }`
      const result = parseInputModalities(withCtx)
      assertEqual(result.contextWindows, { "first/model": 200000, "second/model": 1000000 })
    },
  ],
  [
    "omits contextWindows when a catalog entry has none; rejects a conflicting duplicate",
    () => {
      const noCtx = `const MODELS = {
        FIRST: { id: "first/model", name: "First", inputModalities: ["text"] },
      }`
      assertEqual(parseInputModalities(noCtx).contextWindows, {})
      const conflict = `const MODELS = {
        FIRST: { id: "first/model", name: "First", inputModalities: ["text"], contextWindow: 1e6 },
        SECOND: { id: "first/model", name: "First", inputModalities: ["text"], contextWindow: 2e5 },
      }`
      throws(
        () => parseInputModalities(conflict),
        /conflicting contextWindow entries for first\/model/,
      )
    },
  ],
  [
    "extracts modalities independent of property order",
    () => {
      const result = parseInputModalities(BUNDLE)
      assertEqual([...result.modelIds].sort(), ["alias/model", "first/model", "third/model"])
      assertEqual(result.modalities, { "first/model": ["text", "image"] })
    },
  ],

  [
    "allows duplicate identical entries",
    () => {
      const result = parseInputModalities(
        `const models = [{id: "same/model", name: "Same", inputModalities: ["text", "image"]}, {inputModalities: ["text", "image"], id: "same/model", name: "Same"}]`,
      )
      assertEqual(result.modalities, { "same/model": ["text", "image"] })
    },
  ],

  [
    "rejects conflicting duplicate entries",
    () => {
      throws(
        () =>
          parseInputModalities(
            `const models = [{id: "same/model", name: "Same", inputModalities: ["text"]}, {id: "same/model", name: "Same", inputModalities: ["text", "image"]}]`,
          ),
        /conflicting inputModalities entries for same\/model/,
      )
    },
  ],

  [
    "accepts the upstream file modality and normalizes it out of the advertised set",
    () => {
      // command-code@1.81.0 reports `file` for meta/muse-wonder-1.0 — known
      // upstream vocabulary, not a shape change. The runtime forwards text +
      // image parts only, so the returned array is normalized.
      const result = parseInputModalities(
        `const models = [{id: "file/model", name: "File", inputModalities: ["text", "image", "file"]}]`,
      )
      assertEqual(result.modelIds.has("file/model"), true)
      assertEqual(result.modalities, { "file/model": ["text", "image"] })
    },
  ],

  [
    "a file-only model is CLI-covered but stays out of the image map",
    () => {
      const result = parseInputModalities(
        `const models = [{id: "docs/model", name: "Docs", inputModalities: ["text", "file"]}]`,
      )
      assertEqual(result.modelIds.has("docs/model"), true)
      assertEqual(result.modalities, {})
    },
  ],

  [
    "rejects unsupported modality values",
    () => {
      throws(
        () =>
          parseInputModalities(
            `const model = {id: "bad/model", name: "Bad", inputModalities: ["audio"]}`,
          ),
        /unsupported value audio/,
      )
      throws(
        () =>
          parseInputModalities(
            `const model = {id: "bad/model", name: "Bad", inputModalities: ["text", "video"]}`,
          ),
        /unsupported value video/,
      )
    },
  ],

  [
    "skips runtime records whose inputModalities is a binding, not an array literal",
    () => {
      // command-code@1.82.5 ships a catalog response parser whose minified
      // locals collide with top-level string constants (`n` → "auto").
      const result = parseInputModalities(`
        const n = "auto", r = "1000000"
        const models = [{id: "real/model", name: "Real", inputModalities: ["text", "image"], contextWindow: 2e5}]
        function parseModel(e) {
          const { id: n, context_length: r, inputModalities: l } = e
          return { model: { id: n, contextWindow: r, inputModalities: l, other: e.x.inputModalities } }
        }
        function viaMember(o) { return { id: n, name: "x", inputModalities: o.inputModalities } }
      `)
      assertEqual([...result.modelIds], ["real/model"])
      assertEqual(result.contextWindows, { "real/model": 200000 })
    },
  ],

  [
    "still rejects a catalog entry whose inputModalities is a non-array literal",
    () => {
      throws(
        () =>
          parseInputModalities(
            `const model = {id: "bad/model", name: "Bad", inputModalities: "text"}`,
          ),
        /inputModalities for bad\/model must be an array of strings/,
      )
    },
  ],

  [
    "rejects malformed JavaScript instead of silently returning no models",
    () => {
      throws(() => parseInputModalities(`const model = {id: "broken/model"`), /could not parse/)
    },
  ],
])
