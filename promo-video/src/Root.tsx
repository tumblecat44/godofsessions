import { Composition } from "remotion";
import { Promo } from "./Promo";
import { Proof } from "./Proof";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="GodOfSessionsLaunch"
        component={Promo}
        durationInFrames={960}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="GodOfSessionsProof"
        component={Proof}
        durationInFrames={660}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
}
