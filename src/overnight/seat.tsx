import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function OvernightSeat() {
  return (
    <aside className="overnight-rail" aria-label="Overnight">
      <Card>
        <CardHeader>
          <CardTitle>Overnight</CardTitle>
          <CardDescription>
            This seat is empty. This slice does not dispatch night work.
          </CardDescription>
        </CardHeader>
      </Card>
    </aside>
  );
}
