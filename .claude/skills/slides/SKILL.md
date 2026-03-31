---
name: slides
description: Create presentation-ready pptx slide decks from any content — reports, data, notes, or documents. Use when the user wants to create a presentation, slide deck, or pptx.
allowed-tools: Write, Bash, Read, Edit
---

# Slides Skill

Create clean, well-structured pptx presentations from any source content. Generates pptx directly using python-pptx — no intermediate formats, full control over layout.

## Invocation

- `/slides @reports/ops_perspective.md` — create slides from a report
- `/slides @specs/feature-x.md "focus on recommendations only"` — create slides with a specific focus
- `/slides` — create slides from content discussed in conversation

## Prerequisites

- `python-pptx` must be installed (`pip3 install python-pptx`)

Check before starting. If missing, tell the user how to install.

## Folder Structure

```
.claude/skills/slides/
  SKILL.md                              # This file (instructions only)
  assets/
    reference-template.pptx             # Branded pptx template (Museo Slab / Raleway / Travelier colors)
  scripts/
    slide_builder.py                    # Reusable slide generation library — create_presentation()
    create_template.py                  # Regenerate the reference template if brand changes
```

## Step 1: Ask the user

Before generating anything, ask these questions using AskUserQuestion:

**1. Audience** — Who is this for?
- Executive / leadership (big picture, key numbers, recommendations)
- Technical team (more detail, data tables, specifics)
- Mixed / general audience (balanced)
- Other (user describes)

**2. Detail level** — How dense should slides be?
- Light (1-2 bullets per slide, very visual, more slides)
- Medium (2-3 bullets per slide, balanced)
- Comprehensive (4-6 bullets per slide, full data tables, evidence quotes, detailed breakdowns — a self-contained reference deck that tells the full story without a presenter)

**3. Focus** — What to emphasize?
- Full document (convert everything)
- Key findings + recommendations only
- Data & metrics focus
- Custom (user specifies)

**4. Output location** — Where to save?
- Same directory as source file (default)
- User specifies path

## Step 2: Read and analyze the source

Read the source content. Understand its structure — what are the main sections, key data points, tables, and conclusions.

## Step 3: Plan the slides

**Before planning, read the reference example** at `assets/reference-example.json` (relative to this skill's directory). This is a gold-standard comprehensive deck. Match its style for:
- Slide structure and flow (title → section → content pattern)
- Title formatting (use descriptive titles, not abbreviated)
- How callouts, bullets, sub-bullets, quotes, and tables are combined per slide
- Density and level of detail per slide
- How large report sections are split across multiple slides

Based on the user's audience, detail level, and focus, plan the slide deck as a JSON structure. Each slide is one of three types:

### Slide types

**1. Title slide** — opening slide with presentation title and subtitle
```json
{"type": "title", "title": "Report Name", "subtitle": "Date | Context"}
```

**2. Section divider** — visual break between major sections
```json
{"type": "section", "title": "Pain Points"}
```

**3. Content slide** — the main slide type. Can contain bullets, a key metric callout, evidence quotes, and/or a table.
```json
{
  "type": "content",
  "title": "Slide Title",
  "callout": "14,143 total messages across 80 groups",
  "bullets": [
    "Ops sends ~175 messages/day",
    {"text": "Top 4 members handle 37% of outbound", "sub_bullets": [
      "Thanah: 31.9 msgs/day across 22 groups",
      "Kseniia: 27.3 msgs/day across 20 groups"
    ]}
  ],
  "quotes": [
    "\"Dear team please confirm BW4885536\" — Secil, repeated 12+ times/day"
  ],
  "table": {
    "headers": ["Metric", "Count"],
    "rows": [["Total messages", "14,143"], ["Unique groups", "80"]]
  }
}
```

All fields except `type` and `title` are optional. A content slide can have any combination of callout, bullets, quotes, and table.

- **bullets**: Array of strings or objects. Strings render as top-level bullets. Objects with `sub_bullets` render the main text as a bullet with indented sub-items below.
- **quotes**: Array of strings. Rendered in italic, smaller font, with a left accent bar. Use for real evidence quotes from the source document.
- **callout**: A single bold line in accent color for key metrics / big numbers.

### Content rules

Adapt density based on the user's detail level choice:

| Detail level | Max bullets | Max words/bullet | Max table rows | Approach |
|-------------|------------|-------------------|---------------|----------|
| Light | 2 | 12 | 4 | Key takeaways only, no evidence quotes |
| Medium | 3 | 15 | 6 | Balanced — key points with some supporting data |
| Comprehensive | 6 | 25 | 10 | Full data tables, evidence quotes, detailed breakdowns. Include all tables from the source. Add sub-bullets for context. Use evidence quotes (italic) to illustrate points. Every section from the source gets its own slides. |

**Always enforce:**

1. **Split when content overflows.** Never exceed the density limits. Use numbered titles ("Findings (1/3)") when splitting. More slides is always better than overflowing slides.
2. **Tables stay intact** but split across slides with headers repeated if they exceed max rows.
3. **One idea per slide.** Don't combine unrelated points.
4. **No raw code blocks.** Summarize into bullets.
5. **Evidence quotes are valuable.** Include real quotes from the source as italic bullets to illustrate points. These make the deck credible and grounded.
6. **Include ALL tables from the source** (for Comprehensive mode). Tables are data — don't summarize them away. Split large tables across multiple slides.
7. **Sub-bullets for context.** Use indented sub-bullets to add detail under a main point. This lets you pack more context without overwhelming the main flow.
8. **Don't strip detail — spread it.** If the source has rich content, use more slides rather than cutting content. A 40-slide comprehensive deck is better than a 20-slide deck that lost half the data.

### Adapt to audience

- **Executive**: Lead with conclusions and impact. Numbers first. Skip methodology. End with recommendations.
- **Technical**: Include data tables, examples, evidence. More granular breakdown.
- **Mixed**: Executive framing with supporting data on follow-up slides.

### Slide sequence

Adapt to the content, but generally follow:

1. Title slide — document name + date/context
2. Overview / key takeaway — 1-2 slides
3. Body sections — one section per major theme
4. Data/evidence — tables where relevant
5. Recommendations / next steps
6. Summary — final slide with top 3 takeaways

## Step 4: Generate the pptx

Use `scripts/slide_builder.py` as a library via an inline Python command. This produces only the pptx — no intermediate files.

Run a single Bash command with the slide data embedded directly in Python:

```bash
python3 -c "
import sys; sys.path.insert(0, '.claude/skills/slides/scripts')
from slide_builder import create_presentation
slides_data = [...]  # your planned JSON slides — embed the full list here
create_presentation(slides_data, 'output.pptx')
"
```

**Do NOT write intermediate JSON files.** The slide data goes directly into the Python command. This keeps the output directory clean — only the pptx is created.

### Overflow prevention

When planning slides in Step 3, keep these height estimates in mind to avoid overflow:
- Each bullet line ≈ 0.4 inches
- Each table row ≈ 0.35 inches
- Callout ≈ 0.5 inches
- Title ≈ 0.8 inches
- Max usable height: ~6.5 inches

If a slide would exceed this, split it — this should not happen if content rules were followed.

## Step 5: Report

Print to terminal:
- Output file path
- Number of slides generated
- Audience and detail level used

## Brand Reference

- **Header font:** Museo Slab (bold)
- **Body font:** Raleway
- **Primary text color:** #32373C
- **Accent color:** #072F2F
- **Light gray (table rows):** #F5F5F5
- **Background:** White
