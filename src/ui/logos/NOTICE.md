# Provider marks

The SVG files in this directory are vendored, unmodified, from
[models.dev](https://github.com/anomalyco/models.dev) (MIT), which is also the
source OpenCode's provider list uses. Only the subset Bastion can render is kept:
amazon-bedrock, anthropic, deepseek, github-copilot, google, groq, meta, mistral,
moonshotai, openai, opencode, openrouter, xai and zai.

- Upstream license: `UPSTREAM-MIT.txt`.
- OpenCode artwork license: `OPENCODE-MIT.txt`.
- The MIT license covers the assets as distributed by models.dev. It grants no
  rights in any provider's name or logo; the marks only identify the provider
  that ran a model, and imply no affiliation.
- Rendering: each mark is inlined as `currentColor`, so it follows the theme's
  text color instead of carrying brand colors.
- A provider without a mark here gets no logo; Bastion never substitutes a
  generic placeholder.

# Soft Radar

`../radar.css` embeds, unmodified, the three mask images of OpenCode's "Soft
Radar" AI activity mark (`--spinner-grid`, `--spinner-frames`,
`--spinner-still` from OpenCode Desktop 2.4.1's renderer stylesheet, generated
by `packages/ui` `spinner-radar.ts`), so a running agent shows exactly the mark
the host shows on a busy session tab. The plugin SDK does not expose that
component. The artwork is OpenCode's, under `OPENCODE-MIT.txt`.
