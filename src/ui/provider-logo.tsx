import { Show } from "solid-js";

import amazonBedrock from "./logos/amazon-bedrock.svg?raw";
import anthropic from "./logos/anthropic.svg?raw";
import deepseek from "./logos/deepseek.svg?raw";
import githubCopilot from "./logos/github-copilot.svg?raw";
import google from "./logos/google.svg?raw";
import groq from "./logos/groq.svg?raw";
import meta from "./logos/meta.svg?raw";
import mistral from "./logos/mistral.svg?raw";
import moonshotai from "./logos/moonshotai.svg?raw";
import openai from "./logos/openai.svg?raw";
import opencode from "./logos/opencode.svg?raw";
import openrouter from "./logos/openrouter.svg?raw";
import xai from "./logos/xai.svg?raw";
import zai from "./logos/zai.svg?raw";

function canonicalProvider(providerID: string): string {
  switch (providerID.toLowerCase()) {
    case "google-vertex":
    case "google-vertex-anthropic":
      return "google";
    case "moonshotai-cn":
      return "moonshotai";
    case "zai-coding-plan":
    case "zhipuai":
    case "zhipuai-coding-plan":
      return "zai";
    case "opencode-go":
    case "opencode-zen":
      return "opencode";
    case "meta-llama":
      return "meta";
    default:
      return providerID.toLowerCase();
  }
}

/** Monochrome marks are build-time assets, so inlining them is safe. */
function logoSvg(providerID: string): string | undefined {
  switch (canonicalProvider(providerID)) {
    case "amazon-bedrock":
      return amazonBedrock;
    case "anthropic":
      return anthropic;
    case "deepseek":
      return deepseek;
    case "github-copilot":
      return githubCopilot;
    case "google":
      return google;
    case "groq":
      return groq;
    case "meta":
      return meta;
    case "mistral":
      return mistral;
    case "moonshotai":
      return moonshotai;
    case "openai":
      return openai;
    case "opencode":
      return opencode;
    case "openrouter":
      return openrouter;
    case "xai":
      return xai;
    case "zai":
      return zai;
    default:
      return undefined;
  }
}

/**
 * The provider's mark, in `currentColor`. The slot keeps its width even when the
 * provider has no mark, so titles line up in a column.
 */
export function ProviderLogo(props: { providerID: string | undefined }) {
  const svg = () => (props.providerID === undefined ? undefined : logoSvg(props.providerID));

  return (
    <span class="bn-logo" aria-hidden="true">
      <Show when={svg()}>{(markup) => <span class="bn-logo__glyph" innerHTML={markup()} />}</Show>
    </span>
  );
}
