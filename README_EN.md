# Spreadsheet Task Automation

[简体中文](README.md) | **English**

> Turn a manually completed spreadsheet process into a validated, repeatable, and maintainable workflow template.

`spreadsheet-workflow` is a general-purpose Agent Skill designed for non-technical users. Provide one or more source spreadsheets and a human-verified historical result. The Agent helps identify field relationships and business rules, resolves meaningful ambiguities with the user, and produces a repeatable script or DSL.

It works well for spreadsheet tasks repeated weekly, monthly, or for every new batch, including multi-table joins, field transformations, grouped summaries, and template-based output. The Skill does not contain built-in rules for attendance, finance, sales, or other business domains. Each workflow derives its rules from the user's examples and confirmations.

## Key capabilities

| Capability | Description |
| --- | --- |
| Guided rule discovery | Derives candidate rules from source files, a human-verified result, and an optional blank template, asking only about ambiguities that affect the output |
| Deterministic execution | Saves confirmed logic as a script or a DSL with a fixed runner, so routine runs do not infer the rules again |
| Structure change detection | Re-examines input and template structures on every run, stopping for review when sheets, columns, merged ranges, or other structural elements change |
| Verifiable delivery | Replays historical examples and reports cell-level differences, key totals, unmatched records, and anomalies |
| Versioned improvement | Creates a new version when rules or corrections change, preserves prior versions, and replays confirmed cases before recommending a switch |
| Local data boundary | Stores workflow templates and run records in the current workspace by default and never overwrites source files, verified results, or blank templates |

## How it works

### 1. Create a workflow template

After receiving historical inputs and a human-verified result, the Agent:

1. Identifies the role, sheet structure, and field meaning of each file.
2. Derives join, filter, calculation, layout, and write rules.
3. Confirms key decisions such as duplicate handling, missing values, rounding, and priority.
4. Generates an executable version and replays the historical example.
5. Saves the workflow template, validation results, and unresolved exceptions.

A single verified example only demonstrates that the workflow can replay that case. The first version that passes validation is therefore marked `TRIAL` rather than being presented as fully proven.

### 2. Run a workflow template

For a new batch, the Agent locates the existing workflow template, checks the current input structure, and runs the fixed version. Every run creates a new result file and execution report without overwriting the original files.

### 3. Improve a workflow template

When business rules, spreadsheet structures, or accepted results change, the Agent creates a new version from the user's correction, replays all available historical cases, and preserves the previous version for audit and rollback.

## Quick start

After installing the Skill from SkillHub, invoke it in an Agent that supports Agent Skills:

```text
$spreadsheet-workflow

I have several source spreadsheets and a human-verified historical result.
Help me turn this process into a reusable workflow template.
```

For the first setup, prepare:

| Material | Required | Purpose |
| --- | --- | --- |
| One or more historical source spreadsheets | Yes | Establish the input structures and data relationships |
| A human-verified historical result | Recommended | Discover rules and validate them through replay |
| A blank output template | Optional | Preserve a required layout, formulas, and workbook objects |
| Field definitions and acceptance criteria | As needed | Resolve business decisions that cannot be inferred from examples |

Without a human-verified result, the Agent can still save a `DRAFT` version, but it will not claim that the workflow has been validated.

## Scope

This Skill is a good fit when:

- The same type of spreadsheet work recurs over time.
- The output must follow explicit, executable rules.
- Validation evidence, run records, and version history matter.
- The task involves multi-table joins, calculations, filtering, or template-based output.

It is not intended for:

- One-off exploratory analysis with no reuse requirement.
- Tasks defined only in natural language when critical business decisions cannot be confirmed.
- Workflows that expect built-in rules for a particular business domain.

## Workflow templates and data

Generated workflow templates are stored in the current business project by default:

```text
.table-workflows/<workflow-id>/
```

This directory may contain executable rules, structure fingerprints, dependency locks, historical cases, run reports, and version records. It belongs to the user's business project rather than this Skill repository and should not be published when it contains sensitive data.

## Manual installation

The repository root is the complete `spreadsheet-workflow` Skill. Copy `SKILL.md`, `agents/`, and `references/` to either location:

```text
# Project installation
<target-project>/.agents/skills/spreadsheet-workflow/

# User installation
~/.agents/skills/spreadsheet-workflow/
```

In Codex, you can also ask `$skill-installer` to install the Skill from this repository.

## Repository structure

```text
table-workflows/
├── SKILL.md                    # Skill entry point and core constraints
├── agents/
│   └── openai.yaml             # Agent display metadata and default prompt
├── references/
│   ├── create-workflow.md      # Create a workflow template
│   ├── run-workflow.md         # Run a workflow template
│   ├── improve-workflow.md     # Improve a workflow template
│   ├── workflow-bundle.md      # Workflow template contract
│   └── manifest.schema.json    # Manifest JSON Schema
├── README.md                   # Chinese documentation
└── README_EN.md                # English documentation
```

See [SKILL.md](SKILL.md) for the complete behavior, constraints, and operating modes.
