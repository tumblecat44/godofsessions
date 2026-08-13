export function ToolChip(props: { toolName: string; status: string; output?: string }) {
  return (
    <div data-kind="tool-chip">
      <span>{props.toolName}</span>
      <span>{props.status}</span>
      {props.output ? <pre>{props.output}</pre> : null}
    </div>
  );
}
