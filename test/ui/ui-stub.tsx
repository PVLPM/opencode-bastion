import type { Ui, UiIconProps, UiLoaderProps, UiTooltipProps } from "@opencode/plugin/gui";

/** The three host components the panel may use, reduced to inert test doubles. */
export const uiStub: Pick<Ui, "Icon" | "Tooltip" | "Loader"> = {
  Icon: (props: UiIconProps) => <svg data-icon={props.name} class={props.class} />,
  Tooltip: (props: UiTooltipProps) => <>{props.children}</>,
  Loader: (props: UiLoaderProps) => <span data-loader={props.size ?? "normal"} />,
};
