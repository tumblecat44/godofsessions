# First-run onboarding

After GitHub identity, a first-time profile walks through Meet Morrow, connecting a conversation model, and what Overnight will do, then enters the room. A model is optional. The last button becomes Look around without a model when none is connected.

## Sub-features

- `onboard-meet` shows Meet Morrow and the language toggle.
- `onboard-model` shows conversation-model connect.
- `onboard-overnight` shows the Overnight explanation.
- `onboard-skip-model` enters the room without a conversation model.
- `onboard-enter` enters the room when a model is already connected.

## How to get to it (user POV)

- Finish GitHub sign-in on a profile that has never completed onboarding.
- There is no later entry. After `Enter the room` / `Look around without a model`, this flow is gone.

## Driving it with gos-verify

Preconditions:

- Isolated launch, doctor ok.
- The isolated profile is GitHub-authenticated and `onboardingComplete` is still false.
- If GitHub is missing, stop and report `verified-unreachable` with attempted wait on heading `Just talk to Morrow.` and unmet precondition `GitHub identity in the isolated user-data`.

- **Meet Morrow.** Wait for the first step. Run `wait --role heading --name "Just talk to Morrow."`. The progress button `Meet Morrow` is current. Language buttons `English` and `한국어` are visible.
- **Continue to model.** Choose Continue. Run `click --role button --name "Continue"`. Heading becomes `Connect the model Morrow talks with.`
- **Overnight step.** Choose Continue again. Run `click --role button --name "Continue"`. Heading becomes `Open it. Press once. Go to sleep.`
- **Skip a model.** Choose the finish button. Run `click --role button --name "Look around without a model"`. Workspace nav appears. Ask Morrow is selected. Chat empty heading is `What shall we untangle together?` when no messages exist.
- **Proof.** Screenshot and aria named `first-run-onboarding` after entering the room. Artifacts show the sidebar labels `Ask Morrow`, `Overnight`, and `Settings`.

## Gotchas

- `Enter the room` appears only when a conversation provider is connected. Without one, the same control is `Look around without a model`.
- Connecting a provider on the model step opens OAuth or an API-key dialog. That is a production boundary. Do not type secrets into evidence.
- Language chosen here becomes the interface language. Recipes after this step must use the names for that language.
- GitHub login is not onboarding. If you still see `Start with GitHub.`, you are on the identity gate.
