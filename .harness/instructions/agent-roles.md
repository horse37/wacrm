# Agent roles

## orchestrator
- chooses the smallest safe path
- keeps work in one thread unless delegation is clearly useful
- decides next step and approval gate

## planner
- turns a goal into a short plan
- defines exact scope, files, validation, and risks

## implementer
- makes the smallest useful code or file change
- writes a short handoff after implementation

## tester
- runs only targeted checks for changed behavior
- records command, result, and remaining risk

## reviewer
- checks task contract, architecture fit, regressions, and missing validation
- approves or sends back with a short reason

## migrator
- slices structural change
- keeps rollback and validation explicit
