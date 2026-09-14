import React from "react";
import { Composition } from "remotion";
import { getDurationInFrames } from "../lib/video-ad/validation";
import { getOutputDimensions, OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../lib/video-ad/types";
import {
  DEFAULT_COMPOSITION_PROPS,
  VideoAdComposition,
} from "./AdComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VideoAd"
      component={VideoAdComposition}
      width={OUTPUT_WIDTH}
      height={OUTPUT_HEIGHT}
      fps={OUTPUT_FPS}
      durationInFrames={OUTPUT_FPS}
      defaultProps={DEFAULT_COMPOSITION_PROPS}
      calculateMetadata={({ props }) => {
        const { width, height } = getOutputDimensions(props.outputRatio);
        return {
          durationInFrames: getDurationInFrames(props.metadata.duration),
          width,
          height,
        };
      }}
    />
  );
};
