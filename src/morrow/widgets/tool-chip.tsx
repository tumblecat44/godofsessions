export function ToolChip(props: { toolName: string; status: string; output?: string }) {
  return (
    <div className="tool-chip" data-kind="tool-chip">
      <header>
        <span>{props.toolName}</span>
        <span>{props.status}</span>
      </header>
      {props.output ? <pre>{props.output}</pre> : null}
    </div>
  );
}
