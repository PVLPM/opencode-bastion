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
