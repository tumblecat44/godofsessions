export function SetupScreen(props: { reason: string }) {
  return (
    <main className="setup-screen">
      <h1>Pi is not attached</h1>
      <p>{props.reason}</p>
      <p>Install Node ≥ 22.19 and the pinned Pi package, then relaunch. This screen does not retry in a loop.</p>
    </main>
  );
}
