export function ApprovalCard(props: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={props.title}>
      <h3>{props.title}</h3>
      <p>{props.message}</p>
      <button type="button" onClick={props.onConfirm}>Allow</button>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </div>
  );
}
