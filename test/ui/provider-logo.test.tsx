import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderLogo } from "../../src/ui/provider-logo";

afterEach(() => {
  document.body.innerHTML = "";
});

function glyph(providerID: string): string | undefined {
  const host = document.createElement("div");
  document.body.append(host);
  render(() => <ProviderLogo providerID={providerID} />, host);
  return host.querySelector(".bn-logo__glyph")?.innerHTML;
}

describe("ProviderLogo", () => {
  it("draws the Claude mark for the Claude Agent provider and the Anthropic mark for the API", () => {
    const claude = glyph("claude-agent");
    const anthropic = glyph("anthropic");
    expect(claude).toContain('viewBox="-11.5 -11.5 123 123"');
    expect(anthropic).toContain('viewBox="0 0 40 40"');
    expect(glyph("Claude-Agent")).toBe(claude);
  });

  it("draws nothing for a provider without a mark", () => {
    expect(glyph("someone-new")).toBeUndefined();
  });
});
