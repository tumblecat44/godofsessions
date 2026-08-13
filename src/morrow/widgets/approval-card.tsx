import { Button } from "@/components/ui/button";

export function ApprovalCard(props: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="approval-card" role="alertdialog" aria-label={props.title}>
      <h3>{props.title}</h3>
      <p>{props.message}</p>
      <menu>
        <Button type="button" onClick={props.onConfirm}>Allow</Button>
        <Button type="button" variant="outline" onClick={props.onCancel}>Cancel</Button>
      </menu>
    </div>
  );
}
