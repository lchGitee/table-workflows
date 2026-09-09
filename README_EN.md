# Spreadsheet Task Automation

[简体中文](README.md) | **English**

> Save spreadsheet work you have already done as a reusable workflow, then apply the same rules to the next batch of data.

Do you organize the same spreadsheets every week or month? `spreadsheet-workflow` helps you save that work as a reusable workflow. Provide the original spreadsheets and a result you have already checked. The Agent helps work out the processing rules, asks you to resolve unclear points, and checks the output against your historical result. For the next batch, it applies the confirmed rules. You can also update the workflow when rules or formats change.

## Example uses

| Recurring task | How it can help |
| --- | --- |
| Attendance and payroll sheets | Combine time records, leave records, and staff lists into the company's attendance template; with pay rates and confirmed payroll rules, generate a payroll sheet as well |
| Sales summaries | Summarize store or channel sales by product, region, or month |
| Order and payment reconciliation | Match orders with payments and list unmatched records and amount differences |
| Combining spreadsheets | Join information from separate files using fields such as customer or employee IDs |
| Data cleanup and conversion | Repeat deduplication, filtering, date formatting, and category mapping |
| Filling a fixed template | Organize each batch into the required weekly, monthly, or submission form |

The rules come from your examples and confirmations; the Skill has no built-in industry rules. It is intended for spreadsheet tasks you need to repeat.

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

I organize these spreadsheets every month.
Here are the original files and a result I have already checked.
Help me save the process so I can use it with next month's data.
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
