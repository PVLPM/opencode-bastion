import type {
  IconName,
  Ui,
  UiIconProps,
  UiLoaderProps,
  UiTooltipProps,
} from "@opencode/plugin/gui";

function iconPath(name: IconName): string {
  switch (name) {
    case "shield":
      return "M8 1.8 13 3.5v4c0 3.2-2.1 5.9-5 6.9-2.9-1-5-3.7-5-6.9v-4L8 1.8Z";
    case "chevron-down":
      return "M4 6.5 8 10.5 12 6.5";
    case "circle-exclamation":
      return "M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2ZM8 5.6v3.3M8 11.1v.1";
    case "circle-x":
      return "M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2ZM6.1 6.1l3.8 3.8M9.9 6.1l-3.8 3.8";
    case "check-small":
      return "M3.4 8.4 6.3 11.3 12.6 4.9";
    case "dash":
      return "M4 8h8";
    case "arrow-down-to-line":
      return "M8 2.8v7.4M5.2 7.6 8 10.4l2.8-2.8M3.4 13h9.2";
    case "sessions-stack":
      return "M3 5.2h10M3 8h10M3 10.8h6";
    default:
      return "M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3Z";
  }
}

function iconSize(size: UiIconProps["size"]): number {
  switch (size) {
    case "small":
      return 14;
    case "large":
      return 20;
    default:
      return 16;
  }
}

export const ui: Pick<Ui, "Icon" | "Tooltip" | "Loader"> = {
  Icon: (props: UiIconProps) => (
    <svg
      class={props.class}
      viewBox="0 0 16 16"
      width={iconSize(props.size)}
      height={iconSize(props.size)}
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={iconPath(props.name)} />
    </svg>
  ),
  Tooltip: (props: UiTooltipProps) => <>{props.children}</>,
  Loader: (props: UiLoaderProps) => <span class={props.class} data-preview-loader="true" />,
};
