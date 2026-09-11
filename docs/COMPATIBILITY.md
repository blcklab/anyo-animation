# Stability Contract — 0.1.x

`@blcklab/anyo-animation@0.1.1` is the stable patch of the first animation-runtime line.

## Guaranteed through 0.1.x

- The root entry remains renderer-neutral and does not import Sekai64.
- `@blcklab/anyo-animation/sekai64` remains explicit and optional.
- `@blcklab/anyo-animation/authoring` remains renderer-neutral.
- Existing `anyo.animation` playback-only components from RC.1 remain valid.
- Boolean, number, and trigger parameter semantics remain compatible.
- Snapshots remain JSON-compatible and versioned.
- Data-only marker/state actions remain free of executable JSON code.
- Static Anyo consumers do not receive animation code unless they install and import this package.
- No runtime dependencies are added during the 0.1.x line without a major compatibility review.

## Allowed in patch releases

- Defect fixes
- Additional diagnostics
- Optional fields with backward-compatible defaults
- Performance improvements
- Additional authoring helpers

Breaking authored-data or public TypeScript API changes require a new minor line.
